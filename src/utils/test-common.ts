/**
 * Common Test Utilities - Shared logic for test tools
 *
 * This module provides shared functionality for all test-related tools across different platforms.
 * It includes common test execution logic and utility functions used by platform-specific test tools.
 *
 * Responsibilities:
 * - Shared test execution logic with platform-specific handling via the xcodebuild pipeline
 * - Common error handling and cleanup for test operations
 */

import { log } from './logger.ts';
import type { XcodePlatform } from './xcode.ts';
import { executeXcodeBuildCommand } from './build/index.ts';
import { createTextResponse } from './validation.ts';
import { normalizeTestRunnerEnv } from './environment.ts';
import type { ToolResponse } from '../types/common.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import {
  formatTestDiscovery,
  collectResolvedTestSelectors,
  type TestPreflightResult,
} from './test-preflight.ts';
import { formatToolPreflight } from './build-preflight.ts';
import { createSimulatorTwoPhaseExecutionPlan } from './simulator-test-execution.ts';
import { startBuildPipeline } from './xcodebuild-pipeline.ts';
import { createPendingXcodebuildResponse } from './xcodebuild-output.ts';

export function resolveTestProgressEnabled(progress: boolean | undefined): boolean {
  if (typeof progress === 'boolean') {
    return progress;
  }

  return process.env.XCODEBUILDMCP_RUNTIME === 'mcp';
}

/**
 * Internal logic for running tests with platform-specific handling
 */
export async function handleTestLogic(
  params: {
    workspacePath?: string;
    projectPath?: string;
    scheme: string;
    configuration: string;
    simulatorName?: string;
    simulatorId?: string;
    deviceId?: string;
    useLatestOS?: boolean;
    packageCachePath?: string;
    derivedDataPath?: string;
    extraArgs?: string[];
    preferXcodebuild?: boolean;
    platform: XcodePlatform;
    testRunnerEnv?: Record<string, string>;
    progress?: boolean;
  },
  executor: CommandExecutor = getDefaultCommandExecutor(),
  options?: {
    preflight?: TestPreflightResult;
    toolName?: string;
  },
): Promise<ToolResponse> {
  log(
    'info',
    `Starting test run for scheme ${params.scheme} on platform ${params.platform} (internal)`,
  );

  try {
    const execOpts: CommandExecOptions | undefined = params.testRunnerEnv
      ? { env: normalizeTestRunnerEnv(params.testRunnerEnv) }
      : undefined;

    const isSimulatorPlatform = String(params.platform).includes('Simulator');
    const shouldUseTwoPhaseSimulatorExecution = isSimulatorPlatform && Boolean(options?.preflight);

    const resolvedToolName = options?.toolName ?? 'test_sim';

    const configText = formatToolPreflight({
      operation: 'Test',
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      configuration: params.configuration,
      platform: String(params.platform),
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
    });

    const discoveryText = options?.preflight ? formatTestDiscovery(options.preflight) : undefined;

    const preflightText = discoveryText ? `${configText}\n${discoveryText}` : configText;

    const started = startBuildPipeline({
      operation: 'TEST',
      toolName: resolvedToolName,
      params: {
        scheme: params.scheme,
        configuration: params.configuration,
        platform: String(params.platform),
        preflight: preflightText,
      },
      message: preflightText,
    });

    const { pipeline } = started;

    if (options?.preflight && options.preflight.totalTests > 0) {
      const discoveredTests = collectResolvedTestSelectors(options.preflight);
      const maxTests = 20;
      pipeline.emitEvent({
        type: 'test-discovery',
        timestamp: new Date().toISOString(),
        operation: 'TEST',
        total: discoveredTests.length,
        tests: discoveredTests.slice(0, maxTests),
        truncated: discoveredTests.length > maxTests,
      });
    }

    const platformOptions = {
      platform: params.platform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
      useLatestOS: params.useLatestOS,
      packageCachePath: params.packageCachePath,
      logPrefix: 'Test Run',
    };

    const preflightExtras = options?.preflight ? { testPreflight: options.preflight } : {};

    if (shouldUseTwoPhaseSimulatorExecution) {
      const executionPlan = createSimulatorTwoPhaseExecutionPlan({
        extraArgs: params.extraArgs,
        preflight: options?.preflight,
        resultBundlePath: undefined,
      });

      const buildForTestingResult = await executeXcodeBuildCommand(
        { ...params, extraArgs: executionPlan.buildArgs },
        platformOptions,
        params.preferXcodebuild,
        'build-for-testing',
        executor,
        execOpts,
        pipeline,
      );

      if (buildForTestingResult.isError) {
        return createPendingXcodebuildResponse(started, buildForTestingResult, {
          errorFallbackPolicy: 'if-no-structured-diagnostics',
          extras: preflightExtras,
        });
      }

      pipeline.emitEvent({
        type: 'status',
        timestamp: new Date().toISOString(),
        operation: 'TEST',
        stage: 'PREPARING_TESTS',
        message: 'Preparing tests',
      });

      const testWithoutBuildingResult = await executeXcodeBuildCommand(
        { ...params, extraArgs: executionPlan.testArgs },
        platformOptions,
        params.preferXcodebuild,
        'test-without-building',
        executor,
        execOpts,
        pipeline,
      );

      return createPendingXcodebuildResponse(started, testWithoutBuildingResult, {
        extras: preflightExtras,
      });
    }

    const singlePhaseResult = await executeXcodeBuildCommand(
      params,
      platformOptions,
      params.preferXcodebuild,
      'test',
      executor,
      execOpts,
      pipeline,
    );

    return createPendingXcodebuildResponse(started, singlePhaseResult, {
      extras: preflightExtras,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during test run: ${errorMessage}`);
    return createTextResponse(`Error during test run: ${errorMessage}`, true);
  }
}
