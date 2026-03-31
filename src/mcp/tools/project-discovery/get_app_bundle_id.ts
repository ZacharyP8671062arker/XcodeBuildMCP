/**
 * Project Discovery Plugin: Get App Bundle ID
 *
 * Extracts the bundle identifier from an app bundle (.app) for any Apple platform
 * (iOS, iPadOS, watchOS, tvOS, visionOS).
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const getAppBundleIdSchema = z.object({
  appPath: z.string().describe('Path to the .app bundle'),
});

type GetAppBundleIdParams = z.infer<typeof getAppBundleIdSchema>;

/**
 * Business logic for extracting bundle ID from app.
 * Separated for testing and reusability.
 */
export async function get_app_bundle_idLogic(
  params: GetAppBundleIdParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<ToolResponse> {
  const appPath = params.appPath;
  const headerEvent = header('Get Bundle ID', [{ label: 'App', value: appPath }]);

  if (!fileSystemExecutor.existsSync(appPath)) {
    return toolResponse([
      headerEvent,
      statusLine('error', `File not found: '${appPath}'. Please check the path and try again.`),
    ]);
  }

  log('info', `Starting bundle ID extraction for app: ${appPath}`);

  return withErrorHandling(
    async () => {
      const bundleId = await extractBundleIdFromAppPath(appPath, executor).catch((innerError) => {
        throw new Error(
          `Could not extract bundle ID from Info.plist: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
        );
      });

      log('info', `Extracted app bundle ID: ${bundleId}`);

      return toolResponse(
        [headerEvent, statusLine('success', `Bundle ID\n  \u2514 ${bundleId.trim()}`)],
        {
          nextStepParams: {
            install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
            launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: bundleId.trim() },
            install_app_device: { deviceId: 'DEVICE_UDID', appPath },
            launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: bundleId.trim() },
          },
        },
      );
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => message,
      logMessage: ({ message }) => `Error extracting app bundle ID: ${message}`,
      mapError: ({ message, headerEvent: hdr }) =>
        toolResponse([
          hdr,
          statusLine('error', message),
          statusLine('info', 'Make sure the path points to a valid app bundle (.app directory).'),
        ]),
    },
  );
}

export const schema = getAppBundleIdSchema.shape;

export const handler = createTypedTool(
  getAppBundleIdSchema,
  (params: GetAppBundleIdParams) =>
    get_app_bundle_idLogic(params, getDefaultCommandExecutor(), getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
