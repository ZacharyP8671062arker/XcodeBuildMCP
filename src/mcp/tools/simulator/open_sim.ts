import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const openSimSchema = z.object({});

type OpenSimParams = z.infer<typeof openSimSchema>;

export async function open_simLogic(
  _params: OpenSimParams,
  executor: CommandExecutor,
): Promise<ToolResponse | void> {
  log('info', 'Starting open simulator request');

  const headerEvent = header('Open Simulator');

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        const command = ['open', '-a', 'Simulator'];
        const result = await executor(command, 'Open Simulator', false);

        if (!result.success) {
          return toolResponse([
            headerEvent,
            statusLine('error', `Open simulator operation failed: ${result.error}`),
          ]);
        }

        return toolResponse([headerEvent, statusLine('success', 'Simulator opened successfully')], {
          nextStepParams: {
            boot_sim: { simulatorId: 'UUID_FROM_LIST_SIMS' },
          },
        });
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
      errorMessage: ({ message }) => `Open simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error during open simulator operation: ${message}`,
    },
  );
}

export const schema = openSimSchema.shape;

export const handler = createTypedTool(openSimSchema, open_simLogic, getDefaultCommandExecutor);
