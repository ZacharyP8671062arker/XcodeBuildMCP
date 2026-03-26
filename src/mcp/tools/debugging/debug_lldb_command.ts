import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const baseSchemaObject = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  command: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

const debugLldbCommandSchema = z.preprocess(nullifyEmptyStrings, baseSchemaObject);

export type DebugLldbCommandParams = z.infer<typeof debugLldbCommandSchema>;

export async function debug_lldb_commandLogic(
  params: DebugLldbCommandParams,
  ctx: DebuggerToolContext,
): Promise<ToolResponse> {
  const headerEvent = header('LLDB Command', [{ label: 'Command', value: params.command }]);

  try {
    const output = await ctx.debugger.runCommand(params.debugSessionId, params.command, {
      timeoutMs: params.timeoutMs,
    });
    const trimmed = output.trim();

    return toolResponse([
      headerEvent,
      statusLine('success', 'Command executed'),
      ...(trimmed ? [section('Output', trimmed.split('\n'))] : []),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to run LLDB command: ${message}`),
    ]);
  }
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedToolWithContext<DebugLldbCommandParams, DebuggerToolContext>(
  debugLldbCommandSchema as unknown as z.ZodType<DebugLldbCommandParams, unknown>,
  debug_lldb_commandLogic,
  getDefaultDebuggerToolContext,
);
