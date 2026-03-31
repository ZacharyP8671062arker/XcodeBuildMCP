import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { normalizeSimctlChildEnv } from '../../../utils/environment.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  bundleId: z.string().describe('Bundle identifier of the app to launch'),
  args: z.array(z.string()).optional().describe('Optional arguments to pass to the app'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the launched app (SIMCTL_CHILD_ prefix added automatically)',
    ),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type LaunchAppSimParams = z.infer<typeof internalSchemaObject>;

export async function launch_app_simLogic(
  params: LaunchAppSimParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const simulatorId = params.simulatorId;
  const simulatorDisplayName = params.simulatorName
    ? `"${params.simulatorName}" (${simulatorId})`
    : simulatorId;

  log('info', `Starting xcrun simctl launch request for simulator ${simulatorId}`);

  const headerEvent = header('Launch App', [
    { label: 'Simulator', value: simulatorDisplayName },
    { label: 'Bundle ID', value: params.bundleId },
  ]);

  try {
    const getAppContainerCmd = [
      'xcrun',
      'simctl',
      'get_app_container',
      simulatorId,
      params.bundleId,
      'app',
    ];
    const getAppContainerResult = await executor(getAppContainerCmd, 'Check App Installed', false);
    if (!getAppContainerResult.success) {
      return toolResponse([
        headerEvent,
        statusLine(
          'error',
          'App is not installed on the simulator. Please use install_app_sim before launching. Workflow: build -> install -> launch.',
        ),
      ]);
    }
  } catch {
    return toolResponse([
      headerEvent,
      statusLine(
        'error',
        'App is not installed on the simulator (check failed). Please use install_app_sim before launching. Workflow: build -> install -> launch.',
      ),
    ]);
  }

  return withErrorHandling(
    async () => {
      const command = ['xcrun', 'simctl', 'launch', simulatorId, params.bundleId];
      if (params.args?.length) {
        command.push(...params.args);
      }

      const execOpts = params.env ? { env: normalizeSimctlChildEnv(params.env) } : undefined;
      const result = await executor(command, 'Launch App in Simulator', false, execOpts);

      if (!result.success) {
        return toolResponse([
          headerEvent,
          statusLine('error', `Launch app in simulator operation failed: ${result.error}`),
        ]);
      }

      const pidMatch = result.output?.match(/:\s*(\d+)\s*$/);
      const events = [
        headerEvent,
        statusLine('success', 'App launched successfully'),
        ...(pidMatch ? [detailTree([{ label: 'Process ID', value: pidMatch[1] }])] : []),
      ];

      return toolResponse(events, {
        nextStepParams: {
          open_sim: {},
          start_sim_log_cap: [
            { simulatorId, bundleId: params.bundleId },
            { simulatorId, bundleId: params.bundleId, captureConsole: true },
          ],
        },
      });
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Launch app in simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error during launch app in simulator operation: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
    bundleId: true,
  } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<LaunchAppSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<LaunchAppSimParams, unknown>,
  logicFunction: launch_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
