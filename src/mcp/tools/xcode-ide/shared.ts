import type { ToolResponse } from '../../../types/common.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import type { XcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getServer } from '../../../server/server-state.ts';
import { getXcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

export async function withBridgeToolHandler(
  operation: string,
  callback: (bridge: XcodeToolsBridgeToolHandler) => Promise<ToolResponse>,
): Promise<void> {
  const ctx = getHandlerContext();
  const bridge = getXcodeToolsBridgeToolHandler(getServer());
  if (!bridge) {
    ctx.emit(header(operation));
    ctx.emit(statusLine('error', 'Unable to initialize xcode tools bridge'));
    return;
  }

  const response = await callback(bridge);

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
