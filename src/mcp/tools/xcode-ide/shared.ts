import type { ToolResponse } from '../../../types/common.ts';
import type { XcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getServer } from '../../../server/server-state.ts';
import { getXcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

export async function withBridgeToolHandler(
  operation: string,
  callback: (bridge: XcodeToolsBridgeToolHandler) => Promise<ToolResponse>,
): Promise<ToolResponse> {
  const bridge = getXcodeToolsBridgeToolHandler(getServer());
  if (!bridge) {
    return toolResponse([
      header(operation),
      statusLine('error', 'Unable to initialize xcode tools bridge'),
    ]);
  }
  return callback(bridge);
}
