/**
 * Device Shared Plugin: Get Device App Path (Unified)
 *
 * Gets the app bundle path for a physical device application (iOS, watchOS, tvOS, visionOS) using either a project or workspace.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
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
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';

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

  const headerParams: Array<{ label: string; value: string }> = [
    { label: 'Scheme', value: params.scheme },
  ];
  if (params.workspacePath) {
    headerParams.push({ label: 'Workspace', value: params.workspacePath });
  } else if (params.projectPath) {
    headerParams.push({ label: 'Project', value: params.projectPath });
  }
  headerParams.push({ label: 'Configuration', value: configuration });
  headerParams.push({ label: 'Platform', value: platform });

  const headerEvent = header('Get App Path', headerParams);

  function buildErrorEvents(rawOutput: string): PipelineEvent[] {
    const messages = extractQueryErrorMessages(rawOutput);
    return [
      headerEvent,
      section(`Errors (${messages.length}):`, [...messages.map((m) => `\u{2717} ${m}`), ''], {
        blankLineAfterTitle: true,
      }),
      statusLine('error', 'Query failed.'),
    ];
  }

  log('info', `Getting app path for scheme ${params.scheme} on platform ${platform}`);

  return withErrorHandling(
    async () => {
      let appPath: string;
      try {
        appPath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration,
            platform,
          },
          executor,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolResponse(buildErrorEvents(message));
      }

      return toolResponse(
        [
          headerEvent,
          statusLine('success', 'Success'),
          detailTree([{ label: 'App Path', value: appPath }]),
        ],
        {
          nextStepParams: {
            get_app_bundle_id: { appPath },
            install_app_device: { deviceId: 'DEVICE_UDID', appPath },
            launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
          },
          suppressCliStream: true,
        },
      );
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Error retrieving app path: ${message}`,
      logMessage: ({ message }) => `Error retrieving app path: ${message}`,
      mapError: ({ message }) => toolResponse(buildErrorEvents(message)),
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
