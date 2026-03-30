/**
 * Logging Plugin: Start Simulator Log Capture
 *
 * Starts capturing logs from a specified simulator.
 */

import * as z from 'zod';
import { startLogCapture } from '../../../utils/log-capture/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { SubsystemFilter } from '../../../utils/log_capture.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const startSimLogCapSchema = z.object({
  simulatorId: z
    .uuid()
    .describe('UUID of the simulator to capture logs from (obtained from list_simulators).'),
  bundleId: z.string(),
  captureConsole: z.boolean().optional(),
  subsystemFilter: z
    .union([z.enum(['app', 'all', 'swiftui']), z.array(z.string()).min(1)])
    .default('app')
    .describe('app|all|swiftui|[subsystem]'),
});

type StartSimLogCapParams = z.infer<typeof startSimLogCapSchema>;

function buildSubsystemFilterDescription(subsystemFilter: SubsystemFilter): string {
  if (subsystemFilter === 'all') {
    return 'All logs';
  }
  if (subsystemFilter === 'swiftui') {
    return 'App + SwiftUI logs';
  }
  if (Array.isArray(subsystemFilter) && subsystemFilter.length > 0) {
    return `Custom subsystems: ${subsystemFilter.join(', ')}`;
  }

  return 'Structured logs only';
}

export async function start_sim_log_capLogic(
  params: StartSimLogCapParams,
  _executor: CommandExecutor = getDefaultCommandExecutor(),
  logCaptureFunction: typeof startLogCapture = startLogCapture,
): Promise<ToolResponse> {
  const { bundleId, simulatorId, subsystemFilter } = params;
  const captureConsole = params.captureConsole ?? false;
  const filterDescription = buildSubsystemFilterDescription(subsystemFilter);
  const headerEvent = header('Start Log Capture', [
    { label: 'Simulator', value: simulatorId },
    { label: 'Bundle ID', value: bundleId },
    { label: 'Filter', value: filterDescription },
  ]);

  const logCaptureParams: Parameters<typeof startLogCapture>[0] = {
    simulatorUuid: simulatorId,
    bundleId,
    captureConsole,
    subsystemFilter,
  };
  const { sessionId, error } = await logCaptureFunction(logCaptureParams, _executor);
  if (error) {
    return toolResponse([headerEvent, statusLine('error', `Error starting log capture: ${error}`)]);
  }

  const items: Array<{ label: string; value: string }> = [{ label: 'Session ID', value: sessionId }];
  if (captureConsole) {
    items.push({ label: 'Console', value: 'App relaunched to capture console output' });
  }

  return toolResponse(
    [headerEvent, statusLine('success', 'Log capture started.'), detailTree(items)],
    {
      nextStepParams: {
        stop_sim_log_cap: { logSessionId: sessionId },
      },
    },
  );
}

const publicSchemaObject = z.strictObject(
  startSimLogCapSchema.omit({ simulatorId: true, bundleId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: startSimLogCapSchema,
});

export const handler = createSessionAwareTool<StartSimLogCapParams>({
  internalSchema: startSimLogCapSchema as unknown as z.ZodType<StartSimLogCapParams, unknown>,
  logicFunction: start_sim_log_capLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['simulatorId', 'bundleId'], message: 'Provide simulatorId and bundleId' },
  ],
});
