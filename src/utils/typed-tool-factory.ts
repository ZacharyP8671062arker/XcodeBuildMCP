import * as z from 'zod';
import type { ToolResponse } from '../types/common.ts';
import type { CommandExecutor } from './execution/index.ts';
import { toolResponse } from './tool-response.ts';
import { statusLine } from './tool-event-builders.ts';

import { sessionStore, type SessionDefaults } from './session-store.ts';
import { isSessionDefaultsOptOutEnabled } from './environment.ts';
import { mergeSessionDefaultArgs } from './session-default-args.ts';

function createValidatedHandler<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>,
  getContext: () => TContext,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args: Record<string, unknown>): Promise<ToolResponse> => {
    try {
      const validatedParams = schema.parse(args);

      const response = await logicFunction(validatedParams, getContext());
      return response;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        return toolResponse([statusLine('error', `Parameter validation failed: ${details}`)]);
      }

      throw error;
    }
  };
}

export function createTypedTool<TParams>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<ToolResponse>,
  getExecutor: () => CommandExecutor,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return createValidatedHandler(schema, logicFunction, getExecutor);
}

export function createTypedToolWithContext<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>,
  getContext: () => TContext,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
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
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<ToolResponse>;
  getExecutor: () => CommandExecutor;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
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
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
  return createSessionAwareHandler(opts);
}

function createSessionAwareHandler<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
  const {
    internalSchema,
    logicFunction,
    getContext,
    requirements = [],
    exclusivePairs = [],
  } = opts;

  return async (rawArgs: Record<string, unknown>): Promise<ToolResponse> => {
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
          return toolResponse([
            statusLine(
              'error',
              `Parameter validation failed: Invalid parameters:\nMutually exclusive parameters provided: ${provided.join(', ')}. Provide only one.`,
            ),
          ]);
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
            return toolResponse([statusLine('error', `${title}: ${body}`)]);
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
            return toolResponse([statusLine('error', `${title}: ${body}`)]);
          }
        }
      }

      const validated = internalSchema.parse(merged);
      const response = await logicFunction(validated, getContext());
      return response;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        return toolResponse([statusLine('error', `Parameter validation failed: ${details}`)]);
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
