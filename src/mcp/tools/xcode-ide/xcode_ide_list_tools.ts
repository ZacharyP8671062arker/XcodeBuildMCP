import * as z from 'zod';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({
  refresh: z
    .boolean()
    .optional()
    .describe('When true (default), refreshes from Xcode bridge before returning tool list.'),
});

type Params = z.infer<typeof schemaObject>;

export async function xcodeIdeListToolsLogic(params: Params): Promise<void> {
  const ctx = getHandlerContext();
  const response = await withBridgeToolHandler('Xcode IDE List Tools', async (bridge) =>
    bridge.listToolsTool({ refresh: params.refresh }),
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
  (params: Params) => xcodeIdeListToolsLogic(params),
  () => undefined,
);
