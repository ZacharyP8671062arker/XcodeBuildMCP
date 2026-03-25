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
import {
  getAxePath,
  getBundledAxeEnvironment,
  AXE_NOT_AVAILABLE_MESSAGE,
} from '../../../utils/axe-helpers.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
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

export interface AxeHelpers {
  getAxePath: () => string | null;
  getBundledAxeEnvironment: () => Record<string, string>;
}

const LOG_PREFIX = '[AXe]';

export async function long_pressLogic(
  params: LongPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = {
    getAxePath,
    getBundledAxeEnvironment,
  },
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
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

  try {
    await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
    log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

    const coordinateWarning = getSnapshotUiWarning(simulatorId);
    const warnings = [guard.warningText, coordinateWarning].filter(Boolean);
    const events = [
      headerEvent,
      statusLine('success', `Long press at (${x}, ${y}) for ${duration}ms simulated successfully.`),
      ...warnings.map((w) => statusLine('warning' as const, w)),
    ];

    return toolResponse(events);
  } catch (error) {
    log('error', `${LOG_PREFIX}/${toolName}: Failed - ${error}`);
    if (error instanceof DependencyError) {
      return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
    } else if (error instanceof AxeError) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to simulate long press at (${x}, ${y}): ${error.message}`),
        ...(error.axeOutput ? [section('Details', [error.axeOutput])] : []),
      ]);
    } else if (error instanceof SystemError) {
      return toolResponse([
        headerEvent,
        statusLine('error', `System error executing axe: ${error.message}`),
        ...(error.originalError?.stack
          ? [section('Stack Trace', [error.originalError.stack])]
          : []),
      ]);
    }
    return toolResponse([
      headerEvent,
      statusLine(
        'error',
        `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: longPressSchema,
});

export const handler = createSessionAwareTool<LongPressParams>({
  internalSchema: longPressSchema as unknown as z.ZodType<LongPressParams, unknown>,
  logicFunction: (params: LongPressParams, executor: CommandExecutor) =>
    long_pressLogic(params, executor, {
      getAxePath,
      getBundledAxeEnvironment,
    }),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});

// Helper function for executing axe commands (inlined from src/tools/axe/index.ts)
async function executeAxeCommand(
  commandArgs: string[],
  simulatorId: string,
  commandName: string,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  axeHelpers: AxeHelpers = { getAxePath, getBundledAxeEnvironment },
): Promise<void> {
  // Get the appropriate axe binary path
  const axeBinary = axeHelpers.getAxePath();
  if (!axeBinary) {
    throw new DependencyError('AXe binary not found');
  }

  // Add --udid parameter to all commands
  const fullArgs = [...commandArgs, '--udid', simulatorId];

  // Construct the full command array with the axe binary as the first element
  const fullCommand = [axeBinary, ...fullArgs];

  try {
    // Determine environment variables for bundled AXe
    const axeEnv = axeBinary !== 'axe' ? axeHelpers.getBundledAxeEnvironment() : undefined;

    const result = await executor(
      fullCommand,
      `${LOG_PREFIX}: ${commandName}`,
      false,
      axeEnv ? { env: axeEnv } : undefined,
    );

    if (!result.success) {
      throw new AxeError(
        `axe command '${commandName}' failed.`,
        commandName,
        result.error ?? result.output,
        simulatorId,
      );
    }

    // Check for stderr output in successful commands
    if (result.error) {
      log(
        'warn',
        `${LOG_PREFIX}: Command '${commandName}' produced stderr output but exited successfully. Output: ${result.error}`,
      );
    }

    // Function now returns void - the calling code creates its own response
  } catch (error) {
    if (error instanceof Error) {
      if (error instanceof AxeError) {
        throw error;
      }

      // Otherwise wrap it in a SystemError
      throw new SystemError(`Failed to execute axe command: ${error.message}`, error);
    }

    // For any other type of error
    throw new SystemError(`Failed to execute axe command: ${String(error)}`);
  }
}
