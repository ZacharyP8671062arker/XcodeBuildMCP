/**
 * Device Shared Plugin: Build and Run Device (Unified)
 *
 * Builds, installs, and launches an app on a physical Apple device.
 */

import { join } from 'node:path';
import * as z from 'zod';
import type { ToolResponse, SharedBuildParams, NextStepParamsMap } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  createBuildRunResultEvents,
  createPendingXcodebuildResponse,
  emitPipelineError,
  emitPipelineNotice,
} from '../../../utils/xcodebuild-output.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to build and run'),
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables to pass to the launched app (as key-value dictionary)'),
});

const buildRunDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildRunDeviceParams = z.infer<typeof buildRunDeviceSchema>;

export async function build_run_deviceLogic(
  params: BuildRunDeviceParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  const platform = mapDevicePlatform(params.platform);

  try {
    const configuration = params.configuration ?? 'Debug';

    const sharedBuildParams: SharedBuildParams = {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      derivedDataPath: params.derivedDataPath,
      extraArgs: params.extraArgs,
    };

    const platformOptions = {
      platform,
      logPrefix: `${platform} Device Build`,
    };

    const preflightText = formatToolPreflight({
      operation: 'Build & Run',
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      configuration,
      platform: String(platform),
      deviceId: params.deviceId,
    });

    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_device',
      params: {
        scheme: params.scheme,
        configuration,
        platform: String(platform),
        preflight: preflightText,
      },
      message: preflightText,
    });

    // Build
    const buildResult = await executeXcodeBuildCommand(
      sharedBuildParams,
      platformOptions,
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

    // Resolve app path
    emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
      code: 'build-run-step',
      data: { step: 'resolve-app-path', status: 'started' },
    });

    let appPath: string;
    try {
      appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration: params.configuration,
          platform,
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

    // Extract bundle ID
    let bundleId: string;
    try {
      bundleId = (await extractBundleIdFromAppPath(appPath, executor)).trim();
      if (bundleId.length === 0) {
        throw new Error('Empty bundle ID returned');
      }
      log('info', `Bundle ID for run: ${bundleId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Failed to extract bundle ID: ${errorMessage}`);
      emitPipelineError(started, 'BUILD', `Failed to extract bundle ID: ${errorMessage}`);
      return createPendingXcodebuildResponse(started, {
        content: [],
        isError: true,
      });
    }

    // Install app on device
    emitPipelineNotice(started, 'BUILD', 'Installing app', 'info', {
      code: 'build-run-step',
      data: { step: 'install-app', status: 'started' },
    });

    try {
      const installResult = await executor(
        ['xcrun', 'devicectl', 'device', 'install', 'app', '--device', params.deviceId, appPath],
        'Install app on device',
        false,
      );
      if (!installResult.success) {
        throw new Error(installResult.error ?? 'Failed to install app');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Failed to install app on device: ${errorMessage}`);
      emitPipelineError(started, 'BUILD', `Failed to install app on device: ${errorMessage}`);
      return createPendingXcodebuildResponse(started, {
        content: [],
        isError: true,
      });
    }

    emitPipelineNotice(started, 'BUILD', 'App installed', 'success', {
      code: 'build-run-step',
      data: { step: 'install-app', status: 'succeeded' },
    });

    // Launch app on device
    emitPipelineNotice(started, 'BUILD', 'Launching app', 'info', {
      code: 'build-run-step',
      data: { step: 'launch-app', status: 'started', appPath },
    });

    let processId: number | undefined;
    try {
      const tempJsonPath = join(fileSystemExecutor.tmpdir(), `launch-${Date.now()}.json`);
      const command = [
        'xcrun',
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        params.deviceId,
        '--json-output',
        tempJsonPath,
        '--terminate-existing',
      ];

      if (params.env && Object.keys(params.env).length > 0) {
        command.push('--environment-variables', JSON.stringify(params.env));
      }

      command.push(bundleId);

      const launchResult = await executor(command, 'Launch app on device', false);
      if (!launchResult.success) {
        throw new Error(launchResult.error ?? 'Failed to launch app');
      }

      try {
        const jsonContent = await fileSystemExecutor.readFile(tempJsonPath, 'utf8');
        const parsedData: unknown = JSON.parse(jsonContent);
        if (
          parsedData &&
          typeof parsedData === 'object' &&
          'result' in parsedData &&
          parsedData.result &&
          typeof parsedData.result === 'object' &&
          'process' in parsedData.result &&
          parsedData.result.process &&
          typeof parsedData.result.process === 'object' &&
          'processIdentifier' in parsedData.result.process &&
          typeof parsedData.result.process.processIdentifier === 'number'
        ) {
          processId = parsedData.result.process.processIdentifier as number;
        }
      } catch {
        log('warn', 'Failed to parse launch JSON output for process ID');
      } finally {
        await fileSystemExecutor.rm(tempJsonPath, { force: true }).catch(() => {});
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Failed to launch app on device: ${errorMessage}`);
      emitPipelineError(started, 'BUILD', `Failed to launch app on device: ${errorMessage}`);
      return createPendingXcodebuildResponse(started, {
        content: [],
        isError: true,
      });
    }

    log('info', `Device build and run succeeded for scheme ${params.scheme}.`);

    const nextStepParams: NextStepParamsMap = {
      start_device_log_cap: {
        deviceId: params.deviceId,
        bundleId,
      },
    };

    if (processId !== undefined) {
      nextStepParams.stop_app_device = {
        deviceId: params.deviceId,
        processId,
      };
    }

    return createPendingXcodebuildResponse(
      started,
      {
        content: [],
        isError: false,
        nextStepParams,
      },
      {
        tailEvents: createBuildRunResultEvents({
          scheme: params.scheme,
          platform: String(platform),
          target: `${platform} Device`,
          appPath,
          bundleId,
          launchState: 'requested',
          ...(processId !== undefined ? { processId } : {}),
        }),
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during device build & run logic: ${errorMessage}`);
    return toolResponse([
      header('Build & Run Device'),
      statusLine('error', `Error during device build and run: ${errorMessage}`),
    ]);
  }
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  deviceId: true,
  platform: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunDeviceParams>({
  internalSchema: buildRunDeviceSchema as unknown as z.ZodType<BuildRunDeviceParams, unknown>,
  logicFunction: (params, executor) =>
    build_run_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
