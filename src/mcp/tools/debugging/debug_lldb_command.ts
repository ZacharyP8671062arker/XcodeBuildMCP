import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
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
): Promise<ToolResponse | void> {
  const headerEvent = header('LLDB Command', [{ label: 'Command', value: params.command }]);

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        const output = await ctx.debugger.runCommand(params.debugSessionId, params.command, {
          timeoutMs: params.timeoutMs,
        });
        const trimmed = output.trim();

        return toolResponse([
          headerEvent,
          statusLine('success', 'Command executed'),
          ...(trimmed ? [section('Output:', trimmed.split('\n'))] : []),
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
      errorMessage: ({ message }) => `Failed to run LLDB command: ${message}`,
    },
  );
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedToolWithContext<DebugLldbCommandParams, DebuggerToolContext>(
  debugLldbCommandSchema as unknown as z.ZodType<DebugLldbCommandParams, unknown>,
  debug_lldb_commandLogic,
  getDefaultDebuggerToolContext,
);
