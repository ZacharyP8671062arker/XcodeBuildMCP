/**
 * UI Testing Plugin: Long Press
 *
 * Long press at specific coordinates for given duration (ms).
 * Use snapshot_ui for precise coordinates (don't guess from screenshots).
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../utils/axe-helpers.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const longPressSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x: z.number().int({ message: 'X coordinate for the long press' }),
  y: z.number().int({ message: 'Y coordinate for the long press' }),
  duration: z
    .number()
    .positive({ message: 'Duration of the long press in milliseconds' })
    .describe('milliseconds'),
});

type LongPressParams = z.infer<typeof longPressSchema>;

const publicSchemaObject = z.strictObject(
  longPressSchema.omit({ simulatorId: true } as const).shape,
);

const LOG_PREFIX = '[AXe]';

export async function long_pressLogic(
  params: LongPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse | void> {
  const toolName = 'long_press';
  const { simulatorId, x, y, duration } = params;

  const headerEvent = header('Long Press', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  const delayInSeconds = Number(duration) / 1000;
  const commandArgs = [
    'touch',
    '-x',
    String(x),
    '-y',
    String(y),
    '--down',
    '--up',
    '--delay',
    String(delayInSeconds),
  ];

  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting for (${x}, ${y}), ${duration}ms on ${simulatorId}`,
  );

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

        const coordinateWarning = getSnapshotUiWarning(simulatorId);
        const warnings = [guard.warningText, coordinateWarning].filter(
          (w): w is string => typeof w === 'string' && w.length > 0,
        );
        return toolResponse([
          headerEvent,
          statusLine(
            'success',
            `Long press at (${x}, ${y}) for ${duration}ms simulated successfully.`,
          ),
          ...warnings.map((w) => statusLine('warning', w)),
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
      errorMessage: ({ message }) => `An unexpected error occurred: ${message}`,
      logMessage: ({ error }) => `${LOG_PREFIX}/${toolName}: Failed - ${error}`,
      mapError: ({ error, headerEvent: hdr }) => {
        if (error instanceof DependencyError) {
          return toolResponse([hdr, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
        } else if (error instanceof AxeError) {
          return toolResponse([
            hdr,
            statusLine('error', `Failed to simulate long press at (${x}, ${y}): ${error.message}`),
            ...(error.axeOutput ? [section('Details', [error.axeOutput])] : []),
          ]);
        } else if (error instanceof SystemError) {
          return toolResponse([
            hdr,
            statusLine('error', `System error executing axe: ${error.message}`),
            ...(error.originalError?.stack
              ? [section('Stack Trace', [error.originalError.stack])]
              : []),
          ]);
        }
        return undefined;
      },
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: longPressSchema,
});

export const handler = createSessionAwareTool<LongPressParams>({
  internalSchema: longPressSchema as unknown as z.ZodType<LongPressParams, unknown>,
  logicFunction: (params: LongPressParams, executor: CommandExecutor) =>
    long_pressLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
