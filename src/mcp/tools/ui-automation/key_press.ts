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
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const keyPressSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  keyCode: z
    .number()
    .int({ message: 'HID keycode to press (0-255)' })
    .min(0)
    .max(255)
    .describe('HID keycode'),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('seconds'),
});

type KeyPressParams = z.infer<typeof keyPressSchema>;

export interface AxeHelpers {
  getAxePath: () => string | null;
  getBundledAxeEnvironment: () => Record<string, string>;
}

const LOG_PREFIX = '[AXe]';

export async function key_pressLogic(
  params: KeyPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = {
    getAxePath,
    getBundledAxeEnvironment,
  },
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
  const toolName = 'key_press';
  const { simulatorId, keyCode, duration } = params;

  const headerEvent = header('Key Press', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  const commandArgs = ['key', String(keyCode)];
  if (duration !== undefined) {
    commandArgs.push('--duration', String(duration));
  }

  log('info', `${LOG_PREFIX}/${toolName}: Starting key press ${keyCode} on ${simulatorId}`);

  try {
    await executeAxeCommand(commandArgs, simulatorId, 'key', executor, axeHelpers);
    log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
    const events = [
      headerEvent,
      statusLine('success', `Key press (code: ${keyCode}) simulated successfully.`),
      ...(guard.warningText ? [statusLine('warning' as const, guard.warningText)] : []),
    ];
    return toolResponse(events);
  } catch (error) {
    log('error', `${LOG_PREFIX}/${toolName}: Failed - ${error}`);
    if (error instanceof DependencyError) {
      return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
    } else if (error instanceof AxeError) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to simulate key press (code: ${keyCode}): ${error.message}`),
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

const publicSchemaObject = z.strictObject(
  keyPressSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: keyPressSchema,
});

export const handler = createSessionAwareTool<KeyPressParams>({
  internalSchema: keyPressSchema as unknown as z.ZodType<KeyPressParams, unknown>,
  logicFunction: (params: KeyPressParams, executor: CommandExecutor) =>
    key_pressLogic(params, executor, {
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
