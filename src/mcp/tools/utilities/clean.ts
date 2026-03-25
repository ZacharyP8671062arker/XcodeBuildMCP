import * as z from 'zod';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { ToolResponse, SharedBuildParams } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { createPendingXcodebuildResponse } from '../../../utils/xcodebuild-output.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';

const baseOptions = {
  scheme: z.string().optional().describe('Optional: The scheme to clean'),
  configuration: z
    .string()
    .optional()
    .describe('Optional: Build configuration to clean (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  platform: z
    .enum([
      'macOS',
      'iOS',
      'iOS Simulator',
      'watchOS',
      'watchOS Simulator',
      'tvOS',
      'tvOS Simulator',
      'visionOS',
      'visionOS Simulator',
    ])
    .optional(),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const cleanSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    })
    .refine((val) => !(val.workspacePath && !val.scheme), {
      message: 'scheme is required when workspacePath is provided.',
      path: ['scheme'],
    }),
);

export type CleanParams = z.infer<typeof cleanSchema>;

export async function cleanLogic(
  params: CleanParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  if (params.workspacePath && !params.scheme) {
    return toolResponse([
      header('Clean'),
      statusLine('error', 'scheme is required when workspacePath is provided.'),
    ]);
  }

  const targetPlatform = params.platform ?? 'iOS';

  const platformMap = {
    macOS: XcodePlatform.macOS,
    iOS: XcodePlatform.iOS,
    'iOS Simulator': XcodePlatform.iOSSimulator,
    watchOS: XcodePlatform.watchOS,
    'watchOS Simulator': XcodePlatform.watchOSSimulator,
    tvOS: XcodePlatform.tvOS,
    'tvOS Simulator': XcodePlatform.tvOSSimulator,
    visionOS: XcodePlatform.visionOS,
    'visionOS Simulator': XcodePlatform.visionOSSimulator,
  };

  const platformEnum = platformMap[targetPlatform];
  if (!platformEnum) {
    return toolResponse([
      header('Clean'),
      statusLine('error', `Unsupported platform: "${targetPlatform}".`),
    ]);
  }

  const hasProjectPath = typeof params.projectPath === 'string';
  const typedParams: SharedBuildParams = {
    ...(hasProjectPath
      ? { projectPath: params.projectPath as string }
      : { workspacePath: params.workspacePath as string }),
    scheme: params.scheme ?? '',
    configuration: params.configuration ?? 'Debug',
    derivedDataPath: params.derivedDataPath,
    extraArgs: params.extraArgs,
  };

  const cleanPlatformMap: Partial<Record<XcodePlatform, XcodePlatform>> = {
    [XcodePlatform.iOSSimulator]: XcodePlatform.iOS,
    [XcodePlatform.watchOSSimulator]: XcodePlatform.watchOS,
    [XcodePlatform.tvOSSimulator]: XcodePlatform.tvOS,
    [XcodePlatform.visionOSSimulator]: XcodePlatform.visionOS,
  };

  const cleanPlatform = cleanPlatformMap[platformEnum] ?? platformEnum;

  const preflightText = formatToolPreflight({
    operation: 'Clean',
    scheme: typedParams.scheme,
    workspacePath: params.workspacePath as string | undefined,
    projectPath: params.projectPath as string | undefined,
    configuration: typedParams.configuration,
    platform: String(cleanPlatform),
  });

  const pipelineParams = {
    scheme: typedParams.scheme,
    configuration: typedParams.configuration,
    platform: String(cleanPlatform),
    preflight: preflightText,
  };

  const started = startBuildPipeline({
    operation: 'BUILD',
    toolName: 'clean',
    params: pipelineParams,
    message: preflightText,
  });

  const buildResult = await executeXcodeBuildCommand(
    typedParams,
    {
      platform: cleanPlatform,
      logPrefix: 'Clean',
    },
    false,
    'clean',
    executor,
    undefined,
    started.pipeline,
  );

  return createPendingXcodebuildResponse(started, buildResult);
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<CleanParams>({
  internalSchema: cleanSchema as unknown as z.ZodType<CleanParams, unknown>,
  logicFunction: cleanLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
