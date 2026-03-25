import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { withBridgeToolHandler } from './shared.ts';

const OPERATION = 'Xcode IDE List Tools';

const schemaObject = z.object({
  refresh: z
    .boolean()
    .optional()
    .describe('When true (default), refreshes from Xcode bridge before returning tool list.'),
});

type Params = z.infer<typeof schemaObject>;

export async function xcodeIdeListToolsLogic(params: Params): Promise<ToolResponse> {
  return withBridgeToolHandler(OPERATION, async (bridge) =>
    bridge.listToolsTool({ refresh: params.refresh }),
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
  return xcodeIdeListToolsLogic(parsed.data);
};
