import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugDetachSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
});

export type DebugDetachParams = z.infer<typeof debugDetachSchema>;

export async function debug_detachLogic(
  params: DebugDetachParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse> {
  const headerEvent = header('Detach');

  try {
    const targetId = params.debugSessionId ?? ctx.debugger.getCurrentSessionId();
    await ctx.debugger.detachSession(targetId ?? undefined);

    return toolResponse([
      headerEvent,
      statusLine('success', `Detached debugger session${targetId ? ` ${targetId}` : ''}`),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to detach debugger: ${message}`),
    ]);
  }
}

export const schema = debugDetachSchema.shape;

export const handler = createTypedToolWithContext<DebugDetachParams, DebuggerToolContext>(
  debugDetachSchema,
  debug_detachLogic,
  getDefaultDebuggerToolContext,
);
