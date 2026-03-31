/**
 * Device Shared Plugin: Get Device App Path (Unified)
 *
 * Gets the app bundle path for a physical device application (iOS, watchOS, tvOS, visionOS) using either a project or workspace.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import path from 'node:path';
import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  formatQueryError,
  formatQueryFailureSummary,
} from '../../../utils/xcodebuild-error-utils.ts';
import {
  extractAppPathFromBuildSettingsOutput,
  getBuildSettingsDestination,
} from '../../../utils/app-path-resolver.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header } from '../../../utils/tool-event-builders.ts';

// Unified schema: XOR between projectPath and workspacePath, sharing common options
const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const getDeviceAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

type GetDeviceAppPathParams = z.infer<typeof getDeviceAppPathSchema>;

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  platform: true,
} as const);

export async function get_device_app_pathLogic(
  params: GetDeviceAppPathParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const platform = mapDevicePlatform(params.platform);
  const configuration = params.configuration ?? 'Debug';
  const preflightText = formatToolPreflight({
    operation: 'Get App Path',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform,
  });

  log('info', `Getting app path for scheme ${params.scheme} on platform ${platform}`);

  return withErrorHandling(
    async () => {
      const command = ['xcodebuild', '-showBuildSettings'];

      const projectPath = params.projectPath
        ? path.resolve(process.cwd(), params.projectPath)
        : undefined;
      const workspacePath = params.workspacePath
        ? path.resolve(process.cwd(), params.workspacePath)
        : undefined;

      if (projectPath) {
        command.push('-project', projectPath);
      } else if (workspacePath) {
        command.push('-workspace', workspacePath);
      }

      command.push('-scheme', params.scheme);
      command.push('-configuration', configuration);
      command.push('-destination', getBuildSettingsDestination(platform));

      const workingDirectory = projectPath
        ? path.dirname(projectPath)
        : workspacePath
          ? path.dirname(workspacePath)
          : undefined;

      const result = await executor(
        command,
        'Get App Path',
        false,
        workingDirectory ? { cwd: workingDirectory } : undefined,
      );

      if (!result.success) {
        const rawOutput = [result.error, result.output].filter(Boolean).join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `\n${preflightText}\n${formatQueryError(rawOutput)}\n\n${formatQueryFailureSummary()}`,
            },
          ],
          isError: true,
        };
      }

      const appPath = extractAppPathFromBuildSettingsOutput(result.output);

      return {
        content: [
          {
            type: 'text',
            text: `\n${preflightText}\n\u2705 Success\n  \u2514 App Path: ${appPath}`,
          },
        ],
        nextStepParams: {
          get_app_bundle_id: { appPath },
          install_app_device: { deviceId: 'DEVICE_UDID', appPath },
          launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
        },
      };
    },
    {
      header: header('Get App Path'),
      errorMessage: ({ message }) => `Error retrieving app path: ${message}`,
      logMessage: ({ message }) => `Error retrieving app path: ${message}`,
      mapError: ({ message }) => ({
        content: [
          {
            type: 'text' as const,
            text: `\n${preflightText}\n${formatQueryError(message)}\n\n${formatQueryFailureSummary()}`,
          },
        ],
        isError: true,
      }),
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetDeviceAppPathParams>({
  internalSchema: getDeviceAppPathSchema as unknown as z.ZodType<GetDeviceAppPathParams, unknown>,
  logicFunction: get_device_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
