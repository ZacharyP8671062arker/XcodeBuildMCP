/**
 * macOS Workspace Plugin: Launch macOS App
 *
 * Launches a macOS application using the 'open' command.
 * IMPORTANT: You MUST provide the appPath parameter.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const launchMacAppSchema = z.object({
  appPath: z.string(),
  args: z.array(z.string()).optional(),
});

type LaunchMacAppParams = z.infer<typeof launchMacAppSchema>;

export async function launch_mac_appLogic(
  params: LaunchMacAppParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<ToolResponse> {
  const headerEvent = header('Launch macOS App', [{ label: 'App', value: params.appPath }]);

  const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
  if (!fileExistsValidation.isValid) {
    return toolResponse([headerEvent, statusLine('error', fileExistsValidation.errorMessage!)]);
  }

  log('info', `Starting launch macOS app request for ${params.appPath}`);

  try {
    const command = ['open', params.appPath];

    if (params.args?.length) {
      command.push('--args', ...params.args);
    }

    await executor(command, 'Launch macOS App');

    return toolResponse([headerEvent, statusLine('success', 'App launched successfully.')]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during launch macOS app operation: ${errorMessage}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Launch macOS app operation failed: ${errorMessage}`),
    ]);
  }
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
