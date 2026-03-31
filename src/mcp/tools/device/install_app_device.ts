/**
 * Device Workspace Plugin: Install App Device
 *
 * Installs an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and appPath.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';

const installAppDeviceSchema = z.object({
  deviceId: z
    .string()
    .min(1, { message: 'Device ID cannot be empty' })
    .describe('UDID of the device (obtained from list_devices)'),
  appPath: z.string(),
});

const publicSchemaObject = installAppDeviceSchema.omit({ deviceId: true } as const);

type InstallAppDeviceParams = z.infer<typeof installAppDeviceSchema>;

export async function install_app_deviceLogic(
  params: InstallAppDeviceParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const { deviceId, appPath } = params;
  const headerEvent = header('Install App', [
    { label: 'Device', value: formatDeviceId(deviceId) },
    { label: 'App', value: appPath },
  ]);

  log('info', `Installing app on device ${deviceId}`);

  return withErrorHandling(
    async () => {
      const result = await executor(
        ['xcrun', 'devicectl', 'device', 'install', 'app', '--device', deviceId, appPath],
        'Install app on device',
        false,
      );

      if (!result.success) {
        return toolResponse([
          headerEvent,
          statusLine('error', `Failed to install app: ${result.error}`),
        ]);
      }

      return toolResponse([headerEvent, statusLine('success', 'App installed successfully.')]);
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to install app on device: ${message}`,
      logMessage: ({ message }) => `Error installing app on device: ${message}`,
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: installAppDeviceSchema,
});

export const handler = createSessionAwareTool<InstallAppDeviceParams>({
  internalSchema: installAppDeviceSchema as unknown as z.ZodType<InstallAppDeviceParams, unknown>,
  logicFunction: install_app_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
