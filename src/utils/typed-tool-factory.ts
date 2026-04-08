import { AsyncLocalStorage } from 'node:async_hooks';
import * as z from 'zod';
import type { ToolHandlerContext } from '../rendering/types.ts';
import { createRenderSession } from '../rendering/render.ts';
import type { CommandExecutor } from './execution/index.ts';
import { statusLine } from './tool-event-builders.ts';

import { sessionStore, type SessionDefaults } from './session-store.ts';
import { isSessionDefaultsOptOutEnabled } from './environment.ts';
import { mergeSessionDefaultArgs } from './session-default-args.ts';

export const handlerContextStorage = new AsyncLocalStorage<ToolHandlerContext>();

export function getHandlerContext(): ToolHandlerContext {
  const ctx = handlerContextStorage.getStore();
  if (!ctx) {
    throw new Error('getHandlerContext() called outside of a tool handler invocation');
  }
  return ctx;
}

function isToolHandlerContext(value: unknown): value is ToolHandlerContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'emit' in value &&
    typeof value.emit === 'function' &&
    'attach' in value &&
    typeof value.attach === 'function'
  );
}

function sessionToTestResult(
  session: ReturnType<typeof createRenderSession>,
): Record<string, unknown> {
  const text = session.finalize();
  const events = [...session.getEvents()];

  const content: Array<Record<string, unknown>> = [];
  if (text) {
    content.push({ type: 'text' as const, text });
  }

  return {
    content,
    isError: session.isError() || undefined,
    ...(events.length > 0 ? { _meta: { events } } : {}),
  };
}

function createValidatedHandler<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<void>,
  getContext: () => TContext,
): (args: Record<string, unknown>, incomingCtx?: ToolHandlerContext) => Promise<void> {
  return async (
    args: Record<string, unknown>,
    providedContext?: TContext | ToolHandlerContext,
  ): Promise<void> => {
    const hasProvidedHandlerContext = isToolHandlerContext(providedContext);
    const session = hasProvidedHandlerContext ? null : createRenderSession('text');
    const ctx: ToolHandlerContext = hasProvidedHandlerContext
      ? providedContext
      : {
          emit: (event) => {
            session!.emit(event);
          },
          attach: (image) => {
            session!.attach(image);
          },
        };
    const context =
      providedContext !== undefined && !hasProvidedHandlerContext ? providedContext : getContext();

    try {
      const validatedParams = schema.parse(args);
      await handlerContextStorage.run(ctx, () => logicFunction(validatedParams, context));
      if (!hasProvidedHandlerContext) {
        return sessionToTestResult(session!) as unknown as void;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        ctx.emit(statusLine('error', `Parameter validation failed: ${details}`));
        if (!hasProvidedHandlerContext) {
          return sessionToTestResult(session!) as unknown as void;
        }
        return;
      }

      throw error;
    }
  };
}

export function createTypedTool<TParams>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<void>,
  getExecutor: () => CommandExecutor,
): (args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void> {
  return createValidatedHandler(schema, logicFunction, getExecutor);
}

export function createTypedToolWithContext<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<void>,
  getContext: () => TContext,
): (args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void> {
  return createValidatedHandler(schema, logicFunction, getContext);
}

export type SessionRequirement =
  | { allOf: (keyof SessionDefaults)[]; message?: string }
  | { oneOf: (keyof SessionDefaults)[]; message?: string };

function missingFromMerged(
  keys: (keyof SessionDefaults)[],
  merged: Record<string, unknown>,
): string[] {
  return keys.filter((k) => merged[k] == null);
}

function formatRequirementError(opts: {
  message: string;
  setHint?: string;
  optOutEnabled: boolean;
}): { title: string; body: string } {
  const title = opts.optOutEnabled
    ? 'Missing required parameters'
    : 'Missing required session defaults';
  const body = opts.optOutEnabled
    ? opts.message
    : [opts.message, opts.setHint].filter(Boolean).join('\n');
  return { title, body };
}

type ToolSchemaShape = Record<string, z.ZodType>;

export function getSessionAwareToolSchemaShape(opts: {
  sessionAware: z.ZodObject<ToolSchemaShape>;
  legacy: z.ZodObject<ToolSchemaShape>;
}): ToolSchemaShape {
  return isSessionDefaultsOptOutEnabled() ? opts.legacy.shape : opts.sessionAware.shape;
}

export function createSessionAwareTool<TParams>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<void>;
  getExecutor: () => CommandExecutor;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void> {
  return createSessionAwareHandler({
    internalSchema: opts.internalSchema,
    logicFunction: opts.logicFunction,
    getContext: opts.getExecutor,
    requirements: opts.requirements,
    exclusivePairs: opts.exclusivePairs,
  });
}

export function createSessionAwareToolWithContext<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<void>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void> {
  return createSessionAwareHandler(opts);
}

function createSessionAwareHandler<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<void>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void> {
  const {
    internalSchema,
    logicFunction,
    getContext,
    requirements = [],
    exclusivePairs = [],
  } = opts;

  return async (
    rawArgs: Record<string, unknown>,
    providedContext?: TContext | ToolHandlerContext,
  ): Promise<void> => {
    const hasProvidedHandlerContext = isToolHandlerContext(providedContext);
    const session = hasProvidedHandlerContext ? null : createRenderSession('text');
    const ctx: ToolHandlerContext = hasProvidedHandlerContext
      ? providedContext
      : {
          emit: (event) => {
            session!.emit(event);
          },
          attach: (image) => {
            session!.attach(image);
          },
        };
    const context =
      providedContext !== undefined && !hasProvidedHandlerContext ? providedContext : getContext();

    const finalize = (): void => {
      if (!hasProvidedHandlerContext) {
        return sessionToTestResult(session!) as unknown as void;
      }
    };

    try {
      const sanitizedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawArgs)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        sanitizedArgs[k] = v;
      }

      for (const pair of exclusivePairs) {
        const provided = pair.filter((k) => Object.prototype.hasOwnProperty.call(sanitizedArgs, k));
        if (provided.length >= 2) {
          ctx.emit(
            statusLine(
              'error',
              `Parameter validation failed: Invalid parameters:\nMutually exclusive parameters provided: ${provided.join(', ')}. Provide only one.`,
            ),
          );
          return finalize();
        }
      }

      const sessionDefaults = sessionStore.getAll();
      const merged = mergeSessionDefaultArgs({
        defaults: sessionDefaults,
        explicitArgs: sanitizedArgs,
        exclusivePairs,
      });

      for (const req of requirements) {
        if ('allOf' in req) {
          const missing = missingFromMerged(req.allOf, merged);
          if (missing.length > 0) {
            const setHint = `Set with: session-set-defaults { ${missing
              .map((k) => `"${k}": "..."`)
              .join(', ')} }`;
            const { title, body } = formatRequirementError({
              message: req.message ?? `Required: ${req.allOf.join(', ')}`,
              setHint,
              optOutEnabled: isSessionDefaultsOptOutEnabled(),
            });
            ctx.emit(statusLine('error', `${title}: ${body}`));
            return finalize();
          }
        } else if ('oneOf' in req) {
          const satisfied = req.oneOf.some((k) => merged[k] != null);
          if (!satisfied) {
            const options = req.oneOf.join(', ');
            const setHints = req.oneOf
              .map((k) => `session-set-defaults { "${k}": "..." }`)
              .join(' OR ');
            const { title, body } = formatRequirementError({
              message: req.message ?? `Provide one of: ${options}`,
              setHint: `Set with: ${setHints}`,
              optOutEnabled: isSessionDefaultsOptOutEnabled(),
            });
            ctx.emit(statusLine('error', `${title}: ${body}`));
            return finalize();
          }
        }
      }

      const validated = internalSchema.parse(merged);
      await handlerContextStorage.run(ctx, () => logicFunction(validated, context));
      return finalize();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        ctx.emit(statusLine('error', `Parameter validation failed: ${details}`));
        return finalize();
      }
      throw error;
    }
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
