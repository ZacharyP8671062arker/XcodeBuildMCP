import * as z from 'zod';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

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

export async function xcodeIdeCallToolLogic(params: Params): Promise<void> {
  const ctx = getHandlerContext();
  const response = await withBridgeToolHandler('Xcode IDE Call Tool', (bridge) =>
    bridge.callToolTool({
      remoteTool: params.remoteTool,
      arguments: params.arguments ?? {},
      timeoutMs: params.timeoutMs,
    }),
  );

  const events = response._meta?.events;
  if (Array.isArray(events)) {
    for (const event of events as PipelineEvent[]) {
      ctx.emit(event);
    }
  }

  for (const contentItem of response.content) {
    if (contentItem.type === 'image') {
      ctx.attach({ data: contentItem.data, mimeType: contentItem.mimeType });
    }
  }

  if (response.nextStepParams) {
    ctx.nextStepParams = response.nextStepParams;
  }
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  (params: Params) => xcodeIdeCallToolLogic(params),
  () => undefined,
);
