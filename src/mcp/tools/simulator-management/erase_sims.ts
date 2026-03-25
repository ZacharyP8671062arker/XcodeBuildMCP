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
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const eraseSimsBaseSchema = z
  .object({
    simulatorId: z.uuid().describe('UDID of the simulator to erase.'),
    shutdownFirst: z.boolean().optional(),
  })
  .passthrough();

const eraseSimsSchema = eraseSimsBaseSchema;

type EraseSimsParams = z.infer<typeof eraseSimsSchema>;

export async function erase_simsLogic(
  params: EraseSimsParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const simulatorId = params.simulatorId;
  const headerEvent = header('Erase Simulator', [
    { label: 'Simulator', value: simulatorId },
    ...(params.shutdownFirst ? [{ label: 'Shutdown First', value: 'true' }] : []),
  ]);

  try {
    log(
      'info',
      `Erasing simulator ${simulatorId}${params.shutdownFirst ? ' (shutdownFirst=true)' : ''}`,
    );

    if (params.shutdownFirst) {
      try {
        await executor(
          ['xcrun', 'simctl', 'shutdown', simulatorId],
          'Shutdown Simulator',
          true,
          undefined,
        );
      } catch {
        // ignore shutdown errors; proceed to erase attempt
      }
    }

    const result = await executor(
      ['xcrun', 'simctl', 'erase', simulatorId],
      'Erase Simulator',
      true,
      undefined,
    );
    if (result.success) {
      return toolResponse([headerEvent, statusLine('success', `Simulator ${simulatorId} erased`)]);
    }

    const errText = result.error ?? 'Unknown error';
    if (/Unable to erase contents and settings.*Booted/i.test(errText) && !params.shutdownFirst) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to erase simulator: ${errText}`),
        section('Hint', [
          `The simulator appears to be Booted. Re-run erase_sims with { simulatorId: '${simulatorId}', shutdownFirst: true } to shut it down before erasing.`,
        ]),
      ]);
    }

    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to erase simulator: ${errText}`),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Error erasing simulators: ${message}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to erase simulator: ${message}`),
    ]);
  }
}

const publicSchemaObject = eraseSimsSchema.omit({ simulatorId: true } as const).passthrough();

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: eraseSimsSchema,
});

export const handler = createSessionAwareTool<EraseSimsParams>({
  internalSchema: eraseSimsSchema as unknown as z.ZodType<EraseSimsParams>,
  logicFunction: erase_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
