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
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

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
) => Promise<{ logContent: string; error?: string }>;

export async function stop_sim_log_capLogic(
  params: StopSimLogCapParams,
  neverExecutor: CommandExecutor = getDefaultCommandExecutor(),
  stopLogCaptureFunction: StopLogCaptureFunction = _stopLogCapture,
  fileSystem: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  const { logContent, error } = await stopLogCaptureFunction(params.logSessionId, fileSystem);
  if (error) {
    return toolResponse([
      header('Stop Log Capture', [{ label: 'Session ID', value: params.logSessionId }]),
      statusLine('error', `Error stopping log capture session ${params.logSessionId}: ${error}`),
    ]);
  }
  return toolResponse([
    header('Stop Log Capture', [{ label: 'Session ID', value: params.logSessionId }]),
    section('Captured Logs', [logContent]),
    statusLine('success', 'Log capture stopped.'),
  ]);
}

export const schema = stopSimLogCapSchema.shape; // MCP SDK compatibility

export const handler = createTypedTool(
  stopSimLogCapSchema,
  (params: StopSimLogCapParams, executor: CommandExecutor) =>
    stop_sim_log_capLogic(params, executor),
  getDefaultCommandExecutor,
);
