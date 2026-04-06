import * as z from 'zod';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({});

export async function xcodeToolsBridgeSyncLogic(): Promise<void> {
  const ctx = getHandlerContext();
  const response = await withBridgeToolHandler('Bridge Sync', async (bridge) => bridge.syncTool());

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
  () => xcodeToolsBridgeSyncLogic(),
  () => undefined,
);
