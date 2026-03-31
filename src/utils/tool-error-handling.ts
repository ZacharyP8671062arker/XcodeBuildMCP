import type { ToolResponse } from '../types/common.ts';
import type { HeaderEvent } from '../types/pipeline-events.ts';
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
): Promise<ToolResponse> {
  try {
    return await run();
  } catch (error) {
    const message = toErrorMessage(error);
    const headerEvent = typeof options.header === 'function' ? options.header() : options.header;

    if (options.mapError) {
      const mapped = options.mapError({ error, message, headerEvent });
      if (mapped) return mapped;
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

    return toolResponse([headerEvent, statusLine('error', errorMsg)]);
  }
}
