/**
 * Logging Plugin: Stop Device Log Capture
 *
 * Stops an active Apple device log capture session and returns the captured logs.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import {
  stopDeviceLogSessionById,
  stopAllDeviceLogCaptures,
} from '../../../utils/log-capture/device-log-sessions.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, section, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const stopDeviceLogCapSchema = z.object({
  logSessionId: z.string(),
});

type StopDeviceLogCapParams = z.infer<typeof stopDeviceLogCapSchema>;

export async function stop_device_log_capLogic(
  params: StopDeviceLogCapParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<ToolResponse> {
  const { logSessionId } = params;
  const headerEvent = header('Stop Log Capture', [{ label: 'Session ID', value: logSessionId }]);

  try {
    log('info', `Attempting to stop device log capture session: ${logSessionId}`);

    const result = await stopDeviceLogSessionById(logSessionId, fileSystemExecutor, {
      timeoutMs: 1000,
      readLogContent: true,
    });

    if (result.error) {
      log('error', `Failed to stop device log capture session ${logSessionId}: ${result.error}`);
      return toolResponse([
        headerEvent,
        statusLine(
          'error',
          `Failed to stop device log capture session ${logSessionId}: ${result.error}`,
        ),
      ]);
    }

    const events = [
      headerEvent,
      statusLine('success', 'Log capture stopped.'),
      ...(result.logFilePath ? [detailTree([{ label: 'Logs', value: result.logFilePath }])] : []),
      section('Captured Logs:', result.logContent.split('\n')),
    ];
    return toolResponse(events);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to stop device log capture session ${logSessionId}: ${message}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to stop device log capture session ${logSessionId}: ${message}`),
    ]);
  }
}

export { stopAllDeviceLogCaptures };

export const schema = stopDeviceLogCapSchema.shape;

export const handler = createTypedTool(
  stopDeviceLogCapSchema,
  (params: StopDeviceLogCapParams) =>
    stop_device_log_capLogic(params, getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
