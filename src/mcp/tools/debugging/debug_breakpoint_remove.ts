import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugBreakpointRemoveSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  breakpointId: z.number().int().positive(),
});

export type DebugBreakpointRemoveParams = z.infer<typeof debugBreakpointRemoveSchema>;

export async function debug_breakpoint_removeLogic(
  params: DebugBreakpointRemoveParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse> {
  const headerEvent = header('Remove Breakpoint');

  try {
    const output = await ctx.debugger.removeBreakpoint(params.debugSessionId, params.breakpointId);
    const rawOutput = output.trim();
    const events = [
      headerEvent,
      statusLine('success', `Breakpoint ${params.breakpointId} removed`),
      ...(rawOutput ? [section('Output', rawOutput.split('\n'))] : []),
    ];

    return toolResponse(events);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to remove breakpoint: ${message}`),
    ]);
  }
}

export const schema = debugBreakpointRemoveSchema.shape;

export const handler = createTypedToolWithContext<DebugBreakpointRemoveParams, DebuggerToolContext>(
  debugBreakpointRemoveSchema,
  debug_breakpoint_removeLogic,
  getDefaultDebuggerToolContext,
);
