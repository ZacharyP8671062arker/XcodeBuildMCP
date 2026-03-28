/**
 * Simulator Get App Path Plugin: Get Simulator App Path (Unified)
 *
 * Gets the app bundle path for a simulator by UUID or name using either a project or workspace file.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import { formatQueryError, formatQueryFailureSummary } from '../../../utils/xcodebuild-error-utils.ts';
import { extractAppPathFromBuildSettingsOutput } from '../../../utils/app-path-resolver.ts';

const SIMULATOR_PLATFORMS = [
  XcodePlatform.iOSSimulator,
  XcodePlatform.watchOSSimulator,
  XcodePlatform.tvOSSimulator,
  XcodePlatform.visionOSSimulator,
] as const;

// Define base schema
const baseGetSimulatorAppPathSchema = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
  scheme: z.string().describe('The scheme to use (Required)'),
  platform: z.enum(SIMULATOR_PLATFORMS),
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator (from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  useLatestOS: z
    .boolean()
    .optional()
    .describe('Whether to use the latest OS version for the named simulator'),
});

// Add XOR validation with preprocessing
const getSimulatorAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseGetSimulatorAppPathSchema
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    })
    .refine((val) => val.simulatorId !== undefined || val.simulatorName !== undefined, {
      message: 'Either simulatorId or simulatorName is required.',
    })
    .refine((val) => !(val.simulatorId !== undefined && val.simulatorName !== undefined), {
      message: 'simulatorId and simulatorName are mutually exclusive. Provide only one.',
    }),
);

type GetSimulatorAppPathParams = z.infer<typeof getSimulatorAppPathSchema>;

/**
 * Exported business logic function for getting app path
 */
export async function get_sim_app_pathLogic(
  params: GetSimulatorAppPathParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const configuration = params.configuration ?? 'Debug';
  const useLatestOS = params.useLatestOS ?? true;

  if (params.simulatorId && params.useLatestOS !== undefined) {
    log(
      'warn',
      `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
    );
  }

  log('info', `Getting app path for scheme ${params.scheme} on platform ${params.platform}`);

  const preflightText = formatToolPreflight({
    operation: 'Get App Path',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: params.platform,
    simulatorName: params.simulatorName,
    simulatorId: params.simulatorId,
  });

  try {
    const command = ['xcodebuild', '-showBuildSettings'];

    if (params.workspacePath) {
      command.push('-workspace', params.workspacePath);
    } else if (params.projectPath) {
      command.push('-project', params.projectPath);
    }

    command.push('-scheme', params.scheme);
    command.push('-configuration', configuration);

    const destinationString = params.simulatorId
      ? constructDestinationString(params.platform, undefined, params.simulatorId)
      : constructDestinationString(params.platform, params.simulatorName, undefined, useLatestOS);

    command.push('-destination', destinationString);

    const result = await executor(command, 'Get App Path', false);

    if (!result.success) {
      const rawOutput = [result.error, result.output].filter(Boolean).join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `\n${preflightText}${formatQueryError(rawOutput)}\n\n${formatQueryFailureSummary()}`,
          },
        ],
        isError: true,
      };
    }

    if (!result.output) {
      return {
        content: [
          {
            type: 'text',
            text: `\n${preflightText}${formatQueryError('Failed to extract build settings output from the result.')}\n\n${formatQueryFailureSummary()}`,
          },
        ],
        isError: true,
      };
    }

    let appPath: string;
    try {
      appPath = extractAppPathFromBuildSettingsOutput(result.output);
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: `\n${preflightText}${formatQueryError('Failed to extract app path from build settings. Make sure the app has been built first.')}\n\n${formatQueryFailureSummary()}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `\n${preflightText}  └ App Path: ${appPath}`,
        },
      ],
      nextStepParams: {
        get_app_bundle_id: { appPath },
        boot_sim: { simulatorId: 'SIMULATOR_UUID' },
        install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
        launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'BUNDLE_ID' },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error retrieving app path: ${errorMessage}`);
    return {
      content: [
        {
          type: 'text',
          text: `\n${preflightText}${formatQueryError(errorMessage)}\n\n${formatQueryFailureSummary()}`,
        },
      ],
      isError: true,
    };
  }
}

const publicSchemaObject = baseGetSimulatorAppPathSchema.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  simulatorId: true,
  simulatorName: true,
  configuration: true,
  useLatestOS: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseGetSimulatorAppPathSchema,
});

export const handler = createSessionAwareTool<GetSimulatorAppPathParams>({
  internalSchema: getSimulatorAppPathSchema as unknown as z.ZodType<GetSimulatorAppPathParams>,
  logicFunction: get_sim_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [
    ['projectPath', 'workspacePath'],
    ['simulatorId', 'simulatorName'],
  ],
});
