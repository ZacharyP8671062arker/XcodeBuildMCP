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
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const setSimAppearanceSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  mode: z.enum(['dark', 'light']).describe('dark|light'),
});

type SetSimAppearanceParams = z.infer<typeof setSimAppearanceSchema>;

export async function set_sim_appearanceLogic(
  params: SetSimAppearanceParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  log('info', `Setting simulator ${params.simulatorId} appearance to ${params.mode} mode`);

  const headerEvent = header('Set Appearance', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Mode', value: params.mode },
  ]);

  return withErrorHandling(
    async () => {
      const command = ['xcrun', 'simctl', 'ui', params.simulatorId, 'appearance', params.mode];
      const result = await executor(command, 'Set Simulator Appearance', false);

      if (!result.success) {
        log(
          'error',
          `Failed to set simulator appearance: ${result.error} (simulator: ${params.simulatorId})`,
        );
        return toolResponse([
          headerEvent,
          statusLine('error', `Failed to set simulator appearance: ${result.error}`),
        ]);
      }

      log('info', `Set simulator ${params.simulatorId} appearance to ${params.mode} mode`);
      return toolResponse([
        headerEvent,
        statusLine('success', `Appearance successfully set to ${params.mode} mode`),
      ]);
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to set simulator appearance: ${message}`,
      logMessage: ({ message }) =>
        `Error during set simulator appearance for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  setSimAppearanceSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: setSimAppearanceSchema,
});

export const handler = createSessionAwareTool<SetSimAppearanceParams>({
  internalSchema: setSimAppearanceSchema as unknown as z.ZodType<SetSimAppearanceParams, unknown>,
  logicFunction: set_sim_appearanceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
