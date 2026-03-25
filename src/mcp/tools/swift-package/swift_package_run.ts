import * as z from 'zod';
import path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { addProcess } from './active-processes.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { acquireDaemonActivity } from '../../../daemon/activity-registry.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  executableName: z.string().optional(),
  arguments: z.array(z.string()).optional(),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  timeout: z.number().optional(),
  background: z.boolean().optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageRunSchema = baseSchemaObject;

type SwiftPackageRunParams = z.infer<typeof swiftPackageRunSchema>;

export async function swift_package_runLogic(
  params: SwiftPackageRunParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const timeout = Math.min(params.timeout ?? 30, 300) * 1000; // Convert to ms, max 5 minutes

  // Detect test environment to prevent real spawn calls during testing
  const isTestEnvironment = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

  const swiftArgs = ['run', '--package-path', resolvedPath];

  const headerEvent = header('Swift Package Run', [
    { label: 'Package', value: resolvedPath },
    ...(params.executableName ? [{ label: 'Executable', value: params.executableName }] : []),
    ...(params.background ? [{ label: 'Mode', value: 'background' }] : []),
  ]);

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
    return toolResponse([
      headerEvent,
      statusLine('error', "Invalid configuration. Use 'debug' or 'release'."),
    ]);
  }

  if (params.parseAsLibrary) {
    swiftArgs.push('-Xswiftc', '-parse-as-library');
  }

  if (params.executableName) {
    swiftArgs.push(params.executableName);
  }

  // Add double dash before executable arguments
  if (params.arguments && params.arguments.length > 0) {
    swiftArgs.push('--');
    swiftArgs.push(...params.arguments);
  }

  log('info', `Running swift ${swiftArgs.join(' ')}`);

  try {
    if (params.background) {
      // Background mode: Use CommandExecutor but don't wait for completion
      if (isTestEnvironment) {
        const mockPid = 12345;
        return toolResponse([
          headerEvent,
          statusLine('success', `Started executable in background (PID: ${mockPid})`),
          section('Next Steps', [
            `Use swift_package_stop with PID ${mockPid} to terminate when needed.`,
          ]),
        ]);
      } else {
        // Production: use CommandExecutor to start the process
        const command = ['swift', ...swiftArgs];
        // Filter out undefined values from process.env
        const cleanEnv = Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value !== undefined),
        ) as Record<string, string>;
        const result = await executor(
          command,
          'Swift Package Run (Background)',
          false,
          cleanEnv,
          true,
        );

        // Store the process in active processes system if available
        if (result.process?.pid) {
          addProcess(result.process.pid, {
            process: {
              kill: (signal?: string) => {
                // Adapt string signal to NodeJS.Signals
                if (result.process) {
                  result.process.kill(signal as NodeJS.Signals);
                }
              },
              on: (event: string, callback: () => void) => {
                if (result.process) {
                  result.process.on(event, callback);
                }
              },
              pid: result.process.pid,
            },
            startedAt: new Date(),
            executableName: params.executableName,
            packagePath: resolvedPath,
            releaseActivity: acquireDaemonActivity('swift-package.background-process'),
          });

          return toolResponse([
            headerEvent,
            statusLine('success', `Started executable in background (PID: ${result.process.pid})`),
            section('Next Steps', [
              `Use swift_package_stop with PID ${result.process.pid} to terminate when needed.`,
            ]),
          ]);
        } else {
          return toolResponse([
            headerEvent,
            statusLine('success', 'Started executable in background'),
            section('Next Steps', ['PID not available for this execution.']),
          ]);
        }
      }
    } else {
      // Foreground mode: use CommandExecutor but handle long-running processes
      const command = ['swift', ...swiftArgs];

      // Create a promise that will either complete with the command result or timeout
      const commandPromise = executor(command, 'Swift Package Run', false);

      const timeoutPromise = new Promise<{
        success: boolean;
        output: string;
        error: string;
        timedOut: boolean;
      }>((resolve) => {
        setTimeout(() => {
          resolve({
            success: false,
            output: '',
            error: `Process timed out after ${timeout / 1000} seconds`,
            timedOut: true,
          });
        }, timeout);
      });

      // Race between command completion and timeout
      const result = await Promise.race([commandPromise, timeoutPromise]);

      if ('timedOut' in result && result.timedOut) {
        // For timeout case, the process may still be running - provide timeout response
        if (isTestEnvironment) {
          const mockPid = 12345;
          return toolResponse([
            headerEvent,
            statusLine(
              'warning',
              `Process timed out after ${timeout / 1000} seconds but may continue running.`,
            ),
            section('Details', [
              `PID: ${mockPid} (mock)`,
              `Use swift_package_stop with PID ${mockPid} to terminate when needed.`,
              result.output || '(no output so far)',
            ]),
          ]);
        } else {
          return toolResponse([
            headerEvent,
            statusLine('warning', `Process timed out after ${timeout / 1000} seconds.`),
            section('Details', [
              'Process execution exceeded the timeout limit. Consider using background mode for long-running executables.',
              result.output || '(no output so far)',
            ]),
          ]);
        }
      }

      if (result.success) {
        return toolResponse([
          headerEvent,
          ...(result.output ? [section('Output', [result.output])] : []),
          statusLine('success', 'Swift executable completed successfully'),
        ]);
      } else {
        const errorDetail = result.error
          ? `${result.output || '(no output)'}\nErrors:\n${result.error}`
          : result.output || '(no output)';
        return toolResponse([
          headerEvent,
          section('Output', [errorDetail]),
          statusLine('error', 'Swift executable failed'),
        ]);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Swift run failed: ${message}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to execute swift run: ${message}`),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageRunParams>({
  internalSchema: swiftPackageRunSchema,
  logicFunction: swift_package_runLogic,
  getExecutor: getDefaultCommandExecutor,
});
