import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header } from '../../../utils/tool-event-builders.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  createBuildRunResultEvents,
  createPendingXcodebuildResponse,
  emitPipelineError,
  emitPipelineNotice,
} from '../../../utils/xcodebuild-output.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { launchMacApp } from '../../../utils/macos-steps.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  arch: z
    .enum(['arm64', 'x86_64'])
    .optional()
    .describe('Architecture to build for (arm64 or x86_64). For macOS only.'),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  arch: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

const buildRunMacOSSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildRunMacOSParams = z.infer<typeof buildRunMacOSSchema>;

export async function buildRunMacOSLogic(
  params: BuildRunMacOSParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  return withErrorHandling(
    async () => {
      const configuration = params.configuration ?? 'Debug';

      const preflightText = formatToolPreflight({
        operation: 'Build & Run',
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: 'macOS',
        arch: params.arch,
      });

      const started = startBuildPipeline({
        operation: 'BUILD',
        toolName: 'build_run_macos',
        params: {
          scheme: params.scheme,
          workspacePath: params.workspacePath,
          projectPath: params.projectPath,
          configuration,
          platform: 'macOS',
          preflight: preflightText,
        },
        message: preflightText,
      });

      const buildResult = await executeXcodeBuildCommand(
        { ...params, configuration },
        { platform: XcodePlatform.macOS, arch: params.arch, logPrefix: 'macOS Build' },
        params.preferXcodebuild ?? false,
        'build',
        executor,
        undefined,
        started.pipeline,
      );

      if (buildResult.isError) {
        return createPendingXcodebuildResponse(started, buildResult, {
          errorFallbackPolicy: 'if-no-structured-diagnostics',
        });
      }

      let appPath: string;
      emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'started' },
      });

      try {
        appPath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration: params.configuration,
            platform: XcodePlatform.macOS,
            derivedDataPath: params.derivedDataPath,
            extraArgs: params.extraArgs,
          },
          executor,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('error', 'Build succeeded, but failed to get app path to launch.');
        emitPipelineError(started, 'BUILD', `Failed to get app path to launch: ${errorMessage}`);
        return createPendingXcodebuildResponse(started, {
          content: [],
          isError: true,
        });
      }

      log('info', `App path determined as: ${appPath}`);
      emitPipelineNotice(started, 'BUILD', 'App path resolved', 'success', {
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'succeeded', appPath },
      });
      emitPipelineNotice(started, 'BUILD', 'Launching app', 'info', {
        code: 'build-run-step',
        data: { step: 'launch-app', status: 'started', appPath },
      });

      const macLaunchResult = await launchMacApp(appPath, executor);

      if (!macLaunchResult.success) {
        log(
          'error',
          `Build succeeded, but failed to launch app ${appPath}: ${macLaunchResult.error}`,
        );
        emitPipelineError(
          started,
          'BUILD',
          `Failed to launch app ${appPath}: ${macLaunchResult.error}`,
        );
        return createPendingXcodebuildResponse(started, {
          content: [],
          isError: true,
        });
      }

      log('info', `macOS app launched successfully: ${appPath}`);
      emitPipelineNotice(started, 'BUILD', 'App launched', 'success', {
        code: 'build-run-step',
        data: { step: 'launch-app', status: 'succeeded', appPath },
      });

      const bundleId = macLaunchResult.bundleId;
      const processId = macLaunchResult.processId;

      return createPendingXcodebuildResponse(
        started,
        {
          content: [],
          isError: false,
        },
        {
          tailEvents: createBuildRunResultEvents({
            scheme: params.scheme,
            platform: 'macOS',
            target: 'macOS',
            appPath,
            bundleId,
            processId,
            launchState: 'requested',
            buildLogPath: started.pipeline.logPath,
          }),
          includeBuildLogFileRef: false,
        },
      );
    },
    {
      header: header('Build & Run macOS'),
      errorMessage: ({ message }) => `Error during macOS build and run: ${message}`,
      logMessage: ({ message }) => `Error during macOS build & run logic: ${message}`,
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunMacOSParams>({
  internalSchema: buildRunMacOSSchema as unknown as z.ZodType<BuildRunMacOSParams, unknown>,
  logicFunction: buildRunMacOSLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
