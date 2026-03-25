import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { withBridgeToolHandler } from './shared.ts';

const OPERATION = 'Xcode IDE Call Tool';

const schemaObject = z.object({
  remoteTool: z.string().min(1).describe('Exact remote Xcode MCP tool name.'),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .describe('Arguments payload to forward to the remote Xcode MCP tool.'),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(120000)
    .optional()
    .describe('Optional timeout override in milliseconds for this single tool call.'),
});

type Params = z.infer<typeof schemaObject>;

export async function xcodeIdeCallToolLogic(params: Params): Promise<ToolResponse> {
  return withBridgeToolHandler(OPERATION, (bridge) =>
    bridge.callToolTool({
      remoteTool: params.remoteTool,
      arguments: params.arguments ?? {},
      timeoutMs: params.timeoutMs,
    }),
  );
}

export const schema = schemaObject.shape;

export const handler = async (args: Record<string, unknown> = {}): Promise<ToolResponse> => {
  const parsed = schemaObject.safeParse(args);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    });
    return toolResponse([
      header(OPERATION),
      section('Validation Errors', details),
      statusLine('error', 'Parameter validation failed'),
    ]);
  }
  return xcodeIdeCallToolLogic(parsed.data);
};
