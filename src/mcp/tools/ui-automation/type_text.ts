/**
 * UI Testing Plugin: Type Text
 *
 * Types text into the iOS Simulator using keyboard input.
 * Supports standard US keyboard characters.
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
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const LOG_PREFIX = '[AXe]';

const typeTextSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  text: z.string().min(1, { message: 'Text cannot be empty' }),
});

type TypeTextParams = z.infer<typeof typeTextSchema>;

const publicSchemaObject = z.strictObject(
  typeTextSchema.omit({ simulatorId: true } as const).shape,
);

export async function type_textLogic(
  params: TypeTextParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse | void> {
  const toolName = 'type_text';

  const { simulatorId, text } = params;
  const headerEvent = header('Type Text', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  const commandArgs = ['type', text];

  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting type "${text.substring(0, 20)}..." on ${simulatorId}`,
  );

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const response = await (async (): Promise<ToolResponse> => {
        await executeAxeCommand(commandArgs, simulatorId, 'type', executor, axeHelpers);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
        return toolResponse([
          headerEvent,
          statusLine('success', 'Text typing simulated successfully.'),
          ...(guard.warningText ? [statusLine('warning' as const, guard.warningText)] : []),
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
      logMessage: ({ message }) => `${LOG_PREFIX}/${toolName}: Failed - ${message}`,
      mapError: ({ error, headerEvent: hdr }) => {
        if (error instanceof DependencyError) {
          return toolResponse([hdr, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
        } else if (error instanceof AxeError) {
          return toolResponse([
            hdr,
            statusLine('error', `Failed to simulate text typing: ${error.message}`),
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
  legacy: typeTextSchema,
});

export const handler = createSessionAwareTool<TypeTextParams>({
  internalSchema: typeTextSchema as unknown as z.ZodType<TypeTextParams, unknown>,
  logicFunction: (params: TypeTextParams, executor: CommandExecutor) =>
    type_textLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
