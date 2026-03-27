/**
 * Device Workspace Plugin: Launch App Device
 *
 * Launches an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and bundleId.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { join } from 'path';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';

type LaunchDataResponse = {
  result?: {
    process?: {
      processIdentifier?: number;
    };
  };
};

const launchAppDeviceSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  bundleId: z.string(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables to pass to the launched app (as key-value dictionary)'),
});

const publicSchemaObject = launchAppDeviceSchema.omit({
  deviceId: true,
  bundleId: true,
} as const);

type LaunchAppDeviceParams = z.infer<typeof launchAppDeviceSchema>;

export async function launch_app_deviceLogic(
  params: LaunchAppDeviceParams,
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): Promise<ToolResponse> {
  const { deviceId, bundleId } = params;

  log('info', `Launching app ${bundleId} on device ${deviceId}`);

  const headerEvent = header('Launch App', [
    { label: 'Device', value: formatDeviceId(deviceId) },
    { label: 'Bundle ID', value: bundleId },
  ]);

  try {
    const tempJsonPath = join(fileSystem.tmpdir(), `launch-${Date.now()}.json`);

    const command = [
      'xcrun',
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      deviceId,
      '--json-output',
      tempJsonPath,
      '--terminate-existing',
    ];

    if (params.env && Object.keys(params.env).length > 0) {
      command.push('--environment-variables', JSON.stringify(params.env));
    }

    command.push(bundleId);

    const result = await executor(command, 'Launch app on device', false);

    if (!result.success) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to launch app: ${result.error}`),
      ]);
    }

    let processId: number | undefined;
    try {
      const jsonContent = await fileSystem.readFile(tempJsonPath, 'utf8');
      const launchData = JSON.parse(jsonContent) as LaunchDataResponse;
      const pid = launchData?.result?.process?.processIdentifier;
      if (typeof pid === 'number') {
        processId = pid;
      }
    } catch (error) {
      log('warn', `Failed to parse launch JSON output: ${error}`);
    } finally {
      await fileSystem.rm(tempJsonPath, { force: true }).catch(() => {});
    }

    const events: PipelineEvent[] = [
      headerEvent,
      statusLine('success', 'App launched successfully.'),
    ];

    if (processId !== undefined) {
      events.push(detailTree([{ label: 'Process ID', value: processId.toString() }]));
    }

    return toolResponse(
      events,
      processId !== undefined
        ? { nextStepParams: { stop_app_device: { deviceId, processId } } }
        : undefined,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error launching app on device: ${errorMessage}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to launch app on device: ${errorMessage}`),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: launchAppDeviceSchema,
});

export const handler = createSessionAwareTool<LaunchAppDeviceParams>({
  internalSchema: launchAppDeviceSchema as unknown as z.ZodType<LaunchAppDeviceParams>,
  logicFunction: (params, executor) =>
    launch_app_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId', 'bundleId'], message: 'Provide deviceId and bundleId' }],
});
