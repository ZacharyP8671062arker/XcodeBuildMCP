import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const eraseSimsSchema = z
  .object({
    simulatorId: z.uuid().describe('UDID of the simulator to erase.'),
    shutdownFirst: z.boolean().optional(),
  })
  .passthrough();

type EraseSimsParams = z.infer<typeof eraseSimsSchema>;

export async function erase_simsLogic(
  params: EraseSimsParams,
  executor: CommandExecutor,
): Promise<ToolResponse | void> {
  const simulatorId = params.simulatorId;
  const headerEvent = header('Erase Simulator', [
    { label: 'Simulator', value: simulatorId },
    ...(params.shutdownFirst ? [{ label: 'Shutdown First', value: 'true' }] : []),
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
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
          return toolResponse([
            headerEvent,
            statusLine('success', 'Simulators were erased successfully'),
          ]);
        }

        const errText = result.error ?? 'Unknown error';
        if (
          /Unable to erase contents and settings.*Booted/i.test(errText) &&
          !params.shutdownFirst
        ) {
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
      })();

      if (!response) {
        return;
      }

      const events = response._meta?.events;
      if (Array.isArray(events)) {
        for (const event of events) {
          ctx.emit(event);
        }
      }
      if (response.nextStepParams) {
        ctx.nextStepParams = response.nextStepParams;
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to erase simulator: ${message}`,
      logMessage: ({ message }) => `Error erasing simulators: ${message}`,
    },
  );
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
