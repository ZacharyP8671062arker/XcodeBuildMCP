import type { ToolResponse } from '../../../types/common.ts';
import { withBridgeToolHandler } from './shared.ts';

export const schema = {};

export const handler = async (): Promise<ToolResponse> => {
  return withBridgeToolHandler('Bridge Sync', async (bridge) => bridge.syncTool());
};
