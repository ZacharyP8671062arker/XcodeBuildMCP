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
import { recordSnapshotUiCall } from './shared/snapshot-ui-state.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const snapshotUiSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
});

type SnapshotUiParams = z.infer<typeof snapshotUiSchema>;

export interface AxeHelpers {
  getAxePath: () => string | null;
  getBundledAxeEnvironment: () => Record<string, string>;
}

const LOG_PREFIX = '[AXe]';

/**
 * Core business logic for snapshot_ui functionality
 */
export async function snapshot_uiLogic(
  params: SnapshotUiParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = {
    getAxePath,
    getBundledAxeEnvironment,
  },
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
  const toolName = 'snapshot_ui';
  const { simulatorId } = params;
  const commandArgs = ['describe-ui'];

  const headerEvent = header('Snapshot UI', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  log('info', `${LOG_PREFIX}/${toolName}: Starting for ${simulatorId}`);

  try {
    const responseText = await executeAxeCommand(
      commandArgs,
      simulatorId,
      'describe-ui',
      executor,
      axeHelpers,
    );

    recordSnapshotUiCall(simulatorId);

    log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
    const events = [
      headerEvent,
      statusLine('success', 'Accessibility hierarchy retrieved successfully.'),
      section('Accessibility Hierarchy', ['```json', responseText, '```']),
      section('Tips', [
        '- Use frame coordinates for tap/swipe (center: x+width/2, y+height/2)',
        '- If a debugger is attached, ensure the app is running (not stopped on breakpoints)',
        '- Screenshots are for visual verification only',
      ]),
      ...(guard.warningText ? [statusLine('warning' as const, guard.warningText)] : []),
    ];
    return toolResponse(events, {
      nextStepParams: {
        snapshot_ui: { simulatorId },
        tap: { simulatorId, x: 0, y: 0 },
        screenshot: { simulatorId },
      },
    });
  } catch (error) {
    log('error', `${LOG_PREFIX}/${toolName}: Failed - ${error}`);
    if (error instanceof DependencyError) {
      return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
    } else if (error instanceof AxeError) {
      return toolResponse([
        headerEvent,
        statusLine('error', `Failed to get accessibility hierarchy: ${error.message}`),
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
  snapshotUiSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: snapshotUiSchema,
});

export const handler = createSessionAwareTool<SnapshotUiParams>({
  internalSchema: snapshotUiSchema as unknown as z.ZodType<SnapshotUiParams, unknown>,
  logicFunction: (params: SnapshotUiParams, executor: CommandExecutor) =>
    snapshot_uiLogic(params, executor, {
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
): Promise<string> {
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

    return result.output.trim();
  } catch (error) {
    if (error instanceof AxeError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;
    throw new SystemError(`Failed to execute axe command: ${message}`, cause);
  }
}
