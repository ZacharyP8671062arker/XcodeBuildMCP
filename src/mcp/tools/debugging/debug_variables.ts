import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugVariablesSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  frameIndex: z.number().int().nonnegative().optional(),
});

export type DebugVariablesParams = z.infer<typeof debugVariablesSchema>;

export async function debug_variablesLogic(
  params: DebugVariablesParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse> {
  const headerEvent = header('Variables');

  try {
    const output = await ctx.debugger.getVariables(params.debugSessionId, {
      frameIndex: params.frameIndex,
    });
    const trimmed = output.trim();

    return toolResponse([
      headerEvent,
      statusLine('success', 'Variables retrieved'),
      ...(trimmed ? [section('Values:', trimmed.split('\n'))] : []),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolResponse([headerEvent, statusLine('error', `Failed to get variables: ${message}`)]);
  }
}

export const schema = debugVariablesSchema.shape;

export const handler = createTypedToolWithContext<DebugVariablesParams, DebuggerToolContext>(
  debugVariablesSchema,
  debug_variablesLogic,
  getDefaultDebuggerToolContext,
);
