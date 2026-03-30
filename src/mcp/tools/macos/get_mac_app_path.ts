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
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  formatQueryError,
  formatQueryFailureSummary,
} from '../../../utils/xcodebuild-error-utils.ts';
import { extractAppPathFromBuildSettingsOutput } from '../../../utils/app-path-resolver.ts';

const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  arch: z
    .enum(['arm64', 'x86_64'])
    .optional()
    .describe('Architecture to build for (arm64 or x86_64). For macOS only.'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  arch: true,
} as const);

const getMacosAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

type GetMacosAppPathParams = z.infer<typeof getMacosAppPathSchema>;

export async function get_mac_app_pathLogic(
  params: GetMacosAppPathParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const configuration = params.configuration ?? 'Debug';
  const preflightText = formatToolPreflight({
    operation: 'Get App Path',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: 'macOS',
    arch: params.arch,
  });

  log('info', `Getting app path for scheme ${params.scheme} on platform macOS`);

  try {
    const command = ['xcodebuild', '-showBuildSettings'];

    if (params.projectPath) {
      command.push('-project', params.projectPath);
    } else if (params.workspacePath) {
      command.push('-workspace', params.workspacePath);
    }

    command.push('-scheme', params.scheme);
    command.push('-configuration', configuration);

    if (params.derivedDataPath) {
      command.push('-derivedDataPath', params.derivedDataPath);
    }

    if (params.arch) {
      const destinationString = `platform=macOS,arch=${params.arch}`;
      command.push('-destination', destinationString);
    }

    if (params.extraArgs) {
      command.push(...params.extraArgs);
    }

    const result = await executor(command, 'Get App Path', false);

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

    if (!result.output) {
      return {
        content: [
          {
            type: 'text',
            text: `\n${preflightText}\n${formatQueryError('Failed to extract build settings output from the result.')}\n\n${formatQueryFailureSummary()}`,
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
            text: `\n${preflightText}\n${formatQueryError('Could not extract app path from build settings.')}\n\n${formatQueryFailureSummary()}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `\n${preflightText}\n✅ Success\n  └ App Path: ${appPath}`,
        },
      ],
      nextStepParams: {
        get_mac_bundle_id: { appPath },
        launch_mac_app: { appPath },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error retrieving app path: ${errorMessage}`);
    return {
      content: [
        {
          type: 'text',
          text: `\n${preflightText}\n${formatQueryError(errorMessage)}\n\n${formatQueryFailureSummary()}`,
        },
      ],
      isError: true,
    };
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetMacosAppPathParams>({
  internalSchema: getMacosAppPathSchema as unknown as z.ZodType<GetMacosAppPathParams, unknown>,
  logicFunction: get_mac_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
