import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const setSimulatorLocationSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  latitude: z.number(),
  longitude: z.number(),
});

type SetSimulatorLocationParams = z.infer<typeof setSimulatorLocationSchema>;

export async function set_sim_locationLogic(
  params: SetSimulatorLocationParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const coords = `${params.latitude},${params.longitude}`;
  const headerEvent = header('Set Location', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Coordinates', value: coords },
  ]);

  if (params.latitude < -90 || params.latitude > 90) {
    return toolResponse([
      headerEvent,
      statusLine('error', 'Latitude must be between -90 and 90 degrees'),
    ]);
  }
  if (params.longitude < -180 || params.longitude > 180) {
    return toolResponse([
      headerEvent,
      statusLine('error', 'Longitude must be between -180 and 180 degrees'),
    ]);
  }

  log('info', `Setting simulator ${params.simulatorId} location to ${coords}`);

  try {
    const command = ['xcrun', 'simctl', 'location', params.simulatorId, 'set', coords];
    const result = await executor(command, 'Set Simulator Location', false, {});

    if (!result.success) {
      log(
        'error',
        `Failed to set simulator location: ${result.error} (simulator: ${params.simulatorId})`,
      );
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to set simulator location: ${result.error}`),
      ]);
    }

    log('info', `Set simulator ${params.simulatorId} location to ${coords}`);
    return toolResponse([headerEvent, statusLine('success', `Location set to ${coords}`)]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(
      'error',
      `Error during set simulator location for simulator ${params.simulatorId}: ${errorMessage}`,
    );
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to set simulator location: ${errorMessage}`),
    ]);
  }
}

const publicSchemaObject = z.strictObject(
  setSimulatorLocationSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: setSimulatorLocationSchema,
});

export const handler = createSessionAwareTool<SetSimulatorLocationParams>({
  internalSchema: setSimulatorLocationSchema as unknown as z.ZodType<
    SetSimulatorLocationParams,
    unknown
  >,
  logicFunction: set_sim_locationLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
