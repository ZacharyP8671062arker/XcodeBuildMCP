import type { ToolResponse } from '../types/common.ts';
import type { ToolHandlerContext } from '../rendering/types.ts';
import type { HeaderEvent, PipelineEvent } from '../types/pipeline-events.ts';
import { toErrorMessage } from './errors.ts';
import { toolResponse } from './tool-response.ts';
import { statusLine } from './tool-event-builders.ts';
import { log } from './logging/index.ts';

export interface WithErrorHandlingOptions {
  header: HeaderEvent | (() => HeaderEvent);
  errorMessage: string | ((ctx: { message: string; error: unknown }) => string);
  logMessage?: string | ((ctx: { message: string; error: unknown }) => string);
  mapError?: (ctx: {
    error: unknown;
    message: string;
    headerEvent: HeaderEvent;
  }) => ToolResponse | undefined;
}

function emitMappedErrorResponse(ctx: ToolHandlerContext, response: ToolResponse): boolean {
  const events = response._meta?.events;
  if (!Array.isArray(events)) {
    return false;
  }

  for (const event of events as PipelineEvent[]) {
    ctx.emit(event);
  }

  if (response.nextStepParams) {
    ctx.nextStepParams = response.nextStepParams;
  }

  return true;
}

/**
 * Wrap a tool logic body with standardized error handling.
 *
 * Catches thrown errors and produces a consistent toolResponse with
 * a header event and an error status line. Use `mapError` for tools
 * that need class-specific error branching.
 */
export async function withErrorHandling(
  run: () => Promise<ToolResponse>,
  options: WithErrorHandlingOptions,
): Promise<ToolResponse>;
export async function withErrorHandling(
  ctx: ToolHandlerContext,
  run: () => Promise<void>,
  options: WithErrorHandlingOptions,
): Promise<void>;
export async function withErrorHandling(
  ctxOrRun: ToolHandlerContext | (() => Promise<ToolResponse | void>),
  runOrOptions: (() => Promise<ToolResponse | void>) | WithErrorHandlingOptions,
  maybeOptions?: WithErrorHandlingOptions,
): Promise<ToolResponse | void> {
  const isCtxMode = typeof ctxOrRun !== 'function';
  const ctx = isCtxMode ? ctxOrRun : undefined;
  const run = (isCtxMode ? runOrOptions : ctxOrRun) as () => Promise<ToolResponse | void>;
  const options = (isCtxMode ? maybeOptions : runOrOptions) as WithErrorHandlingOptions;

  try {
    return await run();
  } catch (error) {
    const message = toErrorMessage(error);
    const headerEvent = typeof options.header === 'function' ? options.header() : options.header;

    if (options.mapError) {
      const mapped = options.mapError({ error, message, headerEvent });
      if (mapped) {
        if (ctx && emitMappedErrorResponse(ctx, mapped)) {
          return;
        }
        if (!ctx) {
          return mapped;
        }
      }
    }

    if (options.logMessage !== undefined) {
      const logMsg =
        typeof options.logMessage === 'function'
          ? options.logMessage({ message, error })
          : options.logMessage;
      log('error', logMsg);
    }

    const errorMsg =
      typeof options.errorMessage === 'function'
        ? options.errorMessage({ message, error })
        : options.errorMessage;

    if (ctx) {
      ctx.emit(headerEvent);
      ctx.emit(statusLine('error', errorMsg));
      return;
    }

    return toolResponse([headerEvent, statusLine('error', errorMsg)]);
  }
}
