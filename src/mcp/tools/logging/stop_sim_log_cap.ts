/**
 * Logging Plugin: Stop Simulator Log Capture
 *
 * Stops an active simulator log capture session and returns the captured logs.
 */

import * as z from 'zod';
import { stopLogCapture as _stopLogCapture } from '../../../utils/log-capture/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, section, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const stopSimLogCapSchema = z.object({
  logSessionId: z.string(),
});

type StopSimLogCapParams = z.infer<typeof stopSimLogCapSchema>;

/**
 * Business logic for stopping simulator log capture session
 */
export type StopLogCaptureFunction = (
  logSessionId: string,
  fileSystem?: FileSystemExecutor,
) => Promise<{ logContent: string; logFilePath?: string; error?: string }>;

export async function stop_sim_log_capLogic(
  params: StopSimLogCapParams,
  _executor: CommandExecutor = getDefaultCommandExecutor(),
  stopLogCaptureFunction: StopLogCaptureFunction = _stopLogCapture,
  fileSystem: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  const headerEvent = header('Stop Log Capture', [
    { label: 'Session ID', value: params.logSessionId },
  ]);
  const { logContent, logFilePath, error } = await stopLogCaptureFunction(
    params.logSessionId,
    fileSystem,
  );
  if (error) {
    return toolResponse([
      headerEvent,
      statusLine('error', `Error stopping log capture session ${params.logSessionId}: ${error}`),
    ]);
  }
  const events = [
    headerEvent,
    statusLine('success', 'Log capture stopped.'),
    ...(logFilePath ? [detailTree([{ label: 'Logs', value: logFilePath }])] : []),
    section('Captured Logs:', logContent.split('\n')),
  ];
  return toolResponse(events);
}

export const schema = stopSimLogCapSchema.shape; // MCP SDK compatibility

export const handler = createTypedTool(
  stopSimLogCapSchema,
  (params: StopSimLogCapParams, executor: CommandExecutor) =>
    stop_sim_log_capLogic(params, executor),
  getDefaultCommandExecutor,
);
