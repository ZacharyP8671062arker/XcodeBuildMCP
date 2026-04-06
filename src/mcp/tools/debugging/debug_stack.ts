import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugStackSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  threadIndex: z.number().int().nonnegative().optional(),
  maxFrames: z.number().int().positive().optional(),
});

export type DebugStackParams = z.infer<typeof debugStackSchema>;

export async function debug_stackLogic(
  params: DebugStackParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse | void> {
  const headerEvent = header('Stack Trace');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        const output = await ctx.debugger.getStack(params.debugSessionId, {
          threadIndex: params.threadIndex,
          maxFrames: params.maxFrames,
        });
        const trimmed = output.trim();

        return toolResponse([
          headerEvent,
          statusLine('success', 'Stack trace retrieved'),
          ...(trimmed ? [section('Frames:', trimmed.split('\n'))] : []),
        ]);
      })();

      if (!response) {
        return;
      }

      const events = response._meta?.events;
      if (Array.isArray(events)) {
        for (const event of events) {
          handlerCtx.emit(event);
        }
      }
      if (response.nextStepParams) {
        handlerCtx.nextStepParams = response.nextStepParams;
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to get stack: ${message}`,
    },
  );
}

export const schema = debugStackSchema.shape;

export const handler = createTypedToolWithContext<DebugStackParams, DebuggerToolContext>(
  debugStackSchema,
  debug_stackLogic,
  getDefaultDebuggerToolContext,
);
