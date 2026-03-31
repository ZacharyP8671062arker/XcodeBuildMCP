import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../utils/axe-helpers.ts';
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const buttonSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  buttonType: z
    .enum(['apple-pay', 'home', 'lock', 'side-button', 'siri'])
    .describe('apple-pay|home|lock|side-button|siri'),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('seconds'),
});

type ButtonParams = z.infer<typeof buttonSchema>;

const LOG_PREFIX = '[AXe]';

export async function buttonLogic(
  params: ButtonParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
  const toolName = 'button';
  const { simulatorId, buttonType, duration } = params;

  const headerEvent = header('Button', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  const commandArgs = ['button', buttonType];
  if (duration !== undefined) {
    commandArgs.push('--duration', String(duration));
  }

  log('info', `${LOG_PREFIX}/${toolName}: Starting ${buttonType} button press on ${simulatorId}`);

  return withErrorHandling(
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'button', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return toolResponse([
        headerEvent,
        statusLine('success', `Hardware button '${buttonType}' pressed successfully.`),
        ...(guard.warningText ? [statusLine('warning' as const, guard.warningText)] : []),
      ]);
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
            statusLine('error', `Failed to press button '${buttonType}': ${error.message}`),
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

const publicSchemaObject = z.strictObject(buttonSchema.omit({ simulatorId: true } as const).shape);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: buttonSchema,
});

export const handler = createSessionAwareTool<ButtonParams>({
  internalSchema: buttonSchema as unknown as z.ZodType<ButtonParams, unknown>,
  logicFunction: (params: ButtonParams, executor: CommandExecutor) =>
    buttonLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
