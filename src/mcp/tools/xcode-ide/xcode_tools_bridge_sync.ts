import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({});

export async function xcodeToolsBridgeSyncLogic(): Promise<ToolResponse> {
  return withBridgeToolHandler('Bridge Sync', async (bridge) => bridge.syncTool());
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  () => xcodeToolsBridgeSyncLogic(),
  () => undefined,
);
