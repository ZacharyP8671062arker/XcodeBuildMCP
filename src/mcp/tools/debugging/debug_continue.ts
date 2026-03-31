import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
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
): Promise<ToolResponse> {
  const headerEvent = header('Continue');

  return withErrorHandling(
    async () => {
      const targetId = params.debugSessionId ?? ctx.debugger.getCurrentSessionId();
      await ctx.debugger.resumeSession(targetId ?? undefined);

      return toolResponse([
        headerEvent,
        statusLine('success', `Resumed debugger session${targetId ? ` ${targetId}` : ''}`),
      ]);
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
