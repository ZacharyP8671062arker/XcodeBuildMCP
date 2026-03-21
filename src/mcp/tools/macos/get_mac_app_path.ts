/**
 * macOS Shared Plugin: Get macOS App Path (Unified)
 *
 * Gets the app bundle path for a macOS application using either a project or workspace.
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
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  formatQueryError,
  formatQueryFailureSummary,
} from '../../../utils/xcodebuild-error-utils.ts';

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

  const preflight = formatToolPreflight({
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
      const errorBlock = formatQueryError(result.error ?? 'Unknown error');
      return {
        content: [
          {
            type: 'text',
            text: [preflight, errorBlock, '', formatQueryFailureSummary()].join('\n'),
          },
        ],
        isError: true,
      };
    }

    if (!result.output) {
      const errorBlock = formatQueryError(
        'Failed to extract build settings output from the result',
      );
      return {
        content: [
          {
            type: 'text',
            text: [preflight, errorBlock, '', formatQueryFailureSummary()].join('\n'),
          },
        ],
        isError: true,
      };
    }

    const builtProductsDirMatch = result.output.match(/^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m);
    const fullProductNameMatch = result.output.match(/^\s*FULL_PRODUCT_NAME\s*=\s*(.+)$/m);

    if (!builtProductsDirMatch || !fullProductNameMatch) {
      const errorBlock = formatQueryError('Could not extract app path from build settings');
      return {
        content: [
          {
            type: 'text',
            text: [preflight, errorBlock, '', formatQueryFailureSummary()].join('\n'),
          },
        ],
        isError: true,
      };
    }

    const builtProductsDir = builtProductsDirMatch[1].trim();
    const fullProductName = fullProductNameMatch[1].trim();
    const appPath = `${builtProductsDir}/${fullProductName}`;

    return {
      content: [
        {
          type: 'text',
          text: [preflight, `  \u{2514} App Path: ${appPath}`].join('\n'),
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
    const errorBlock = formatQueryError(errorMessage);
    return {
      content: [
        {
          type: 'text',
          text: [preflight, errorBlock, '', formatQueryFailureSummary()].join('\n'),
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
