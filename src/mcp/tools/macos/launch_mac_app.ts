import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';
import path from 'node:path';

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

  return withErrorHandling(
    async () => {
      const command = ['open', params.appPath];

      if (params.args?.length) {
        command.push('--args', ...params.args);
      }

      await executor(command, 'Launch macOS App');

      const appName = path.basename(params.appPath, '.app');
      let bundleId: string | undefined;
      try {
        const plistResult = await executor(
          ['/bin/sh', '-c', `defaults read "${params.appPath}/Contents/Info" CFBundleIdentifier`],
          'Extract Bundle ID',
          false,
        );
        if (plistResult.success && plistResult.output) {
          bundleId = plistResult.output.trim();
        }
      } catch {
        // non-fatal
      }

      let processId: number | undefined;
      try {
        const pgrepResult = await executor(['pgrep', '-x', appName], 'Get Process ID', false);
        if (pgrepResult.success && pgrepResult.output) {
          const pid = parseInt(pgrepResult.output.trim().split('\n')[0], 10);
          if (!isNaN(pid)) {
            processId = pid;
          }
        }
      } catch {
        // non-fatal
      }

      const details: Array<{ label: string; value: string }> = [];
      if (bundleId) {
        details.push({ label: 'Bundle ID', value: bundleId });
      }
      if (processId !== undefined) {
        details.push({ label: 'Process ID', value: String(processId) });
      }

      const events: PipelineEvent[] = [
        headerEvent,
        statusLine('success', 'App launched successfully'),
      ];
      if (details.length > 0) {
        events.push(detailTree(details));
      }

      return toolResponse(events);
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Launch macOS app operation failed: ${message}`,
      logMessage: ({ message }) => `Error during launch macOS app operation: ${message}`,
    },
  );
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
