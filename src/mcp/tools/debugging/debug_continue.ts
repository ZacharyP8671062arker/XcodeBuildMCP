import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugContinueSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
});

export type DebugContinueParams = z.infer<typeof debugContinueSchema>;

export async function debug_continueLogic(
  params: DebugContinueParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse | void> {
  const headerEvent = header('Continue');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        const targetId = params.debugSessionId ?? ctx.debugger.getCurrentSessionId();
        await ctx.debugger.resumeSession(targetId ?? undefined);

        return toolResponse([
          headerEvent,
          statusLine('success', `Resumed debugger session${targetId ? ` ${targetId}` : ''}`),
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
      errorMessage: ({ message }) => `Failed to resume debugger: ${message}`,
    },
  );
}

export const schema = debugContinueSchema.shape;

export const handler = createTypedToolWithContext<DebugContinueParams, DebuggerToolContext>(
  debugContinueSchema,
  debug_continueLogic,
  getDefaultDebuggerToolContext,
);
