/**
 * UI Testing Plugin: Key Sequence
 *
 * Press key sequence using HID keycodes on iOS simulator with configurable delay.
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
} from '../../../utils/typed-tool-factory.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const keySequenceSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  keyCodes: z
    .array(z.number().int().min(0).max(255))
    .min(1, { message: 'At least one key code required' })
    .describe('HID keycodes'),
  delay: z.number().min(0, { message: 'Delay must be non-negative' }).optional(),
});

type KeySequenceParams = z.infer<typeof keySequenceSchema>;

const LOG_PREFIX = '[AXe]';

export async function key_sequenceLogic(
  params: KeySequenceParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
  const toolName = 'key_sequence';
  const { simulatorId, keyCodes, delay } = params;

  const headerEvent = header('Key Sequence', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  const commandArgs = ['key-sequence', '--keycodes', keyCodes.join(',')];
  if (delay !== undefined) {
    commandArgs.push('--delay', String(delay));
  }

  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting key sequence [${keyCodes.join(',')}] on ${simulatorId}`,
  );

  try {
    await executeAxeCommand(commandArgs, simulatorId, 'key-sequence', executor, axeHelpers);
    log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
    return toolResponse([
      headerEvent,
      statusLine('success', `Key sequence [${keyCodes.join(',')}] executed successfully.`),
      ...(guard.warningText ? [statusLine('warning' as const, guard.warningText)] : []),
    ]);
  } catch (error) {
    log('error', `${LOG_PREFIX}/${toolName}: Failed - ${error}`);
    if (error instanceof DependencyError) {
      return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
    } else if (error instanceof AxeError) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to execute key sequence: ${error.message}`),
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
  keySequenceSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: keySequenceSchema,
});

export const handler = createSessionAwareTool<KeySequenceParams>({
  internalSchema: keySequenceSchema as unknown as z.ZodType<KeySequenceParams, unknown>,
  logicFunction: (params: KeySequenceParams, executor: CommandExecutor) =>
    key_sequenceLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
