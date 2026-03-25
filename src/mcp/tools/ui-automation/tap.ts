import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
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
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

export interface AxeHelpers {
  getAxePath: () => string | null;
  getBundledAxeEnvironment: () => Record<string, string>;
}

const baseTapSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x: z
    .number()
    .int({ message: 'X coordinate must be an integer' })
    .optional()
    .describe(
      'Fallback tap X coordinate. Prefer label/id targeting first; use coordinates when accessibility targeting is unavailable.',
    ),
  y: z
    .number()
    .int({ message: 'Y coordinate must be an integer' })
    .optional()
    .describe(
      'Fallback tap Y coordinate. Prefer label/id targeting first; use coordinates when accessibility targeting is unavailable.',
    ),
  id: z
    .string()
    .min(1, { message: 'Id must be non-empty' })
    .optional()
    .describe('Recommended tap target: accessibility element id (AXUniqueId).'),
  label: z
    .string()
    .min(1, { message: 'Label must be non-empty' })
    .optional()
    .describe('Recommended when unique: accessibility label (AXLabel).'),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .optional()
    .describe('seconds'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
    .optional()
    .describe('seconds'),
});

const tapSchema = baseTapSchema.superRefine((values, ctx) => {
  const hasX = values.x !== undefined;
  const hasY = values.y !== undefined;
  const hasId = values.id !== undefined;
  const hasLabel = values.label !== undefined;

  if (!hasX && !hasY && hasId && hasLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'Provide either id or label, not both.',
    });
  }

  if (hasX !== hasY) {
    if (!hasX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x'],
        message: 'X coordinate is required when y is provided.',
      });
    }
    if (!hasY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['y'],
        message: 'Y coordinate is required when x is provided.',
      });
    }
  }

  if (!hasX && !hasY && !hasId && !hasLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['x'],
      message: 'Provide an element id/label (recommended) or x/y coordinates as fallback.',
    });
  }
});

type TapParams = z.infer<typeof tapSchema>;

const publicSchemaObject = z.strictObject(baseTapSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export async function tapLogic(
  params: TapParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = {
    getAxePath,
    getBundledAxeEnvironment,
  },
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<ToolResponse> {
  const toolName = 'tap';
  const { simulatorId, x, y, id, label, preDelay, postDelay } = params;

  const headerEvent = header('Tap', [{ label: 'Simulator', value: simulatorId }]);

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage)
    return toolResponse([headerEvent, statusLine('error', guard.blockedMessage)]);

  let targetDescription = '';
  let actionDescription = '';
  let usesCoordinates = false;
  const commandArgs = ['tap'];

  if (x !== undefined && y !== undefined) {
    usesCoordinates = true;
    targetDescription = `(${x}, ${y})`;
    actionDescription = `Tap at ${targetDescription}`;
    commandArgs.push('-x', String(x), '-y', String(y));
  } else if (id !== undefined) {
    targetDescription = `element id "${id}"`;
    actionDescription = `Tap on ${targetDescription}`;
    commandArgs.push('--id', id);
  } else if (label !== undefined) {
    targetDescription = `element label "${label}"`;
    actionDescription = `Tap on ${targetDescription}`;
    commandArgs.push('--label', label);
  } else {
    return toolResponse([
      headerEvent,
      statusLine('error', 'Parameter validation failed: Missing tap target'),
    ]);
  }

  if (preDelay !== undefined) {
    commandArgs.push('--pre-delay', String(preDelay));
  }
  if (postDelay !== undefined) {
    commandArgs.push('--post-delay', String(postDelay));
  }

  log('info', `${LOG_PREFIX}/${toolName}: Starting for ${targetDescription} on ${simulatorId}`);

  try {
    await executeAxeCommand(commandArgs, simulatorId, 'tap', executor, axeHelpers);
    log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

    const coordinateWarning = usesCoordinates ? getSnapshotUiWarning(simulatorId) : null;
    const warnings = [guard.warningText, coordinateWarning].filter(Boolean);
    const events = [
      headerEvent,
      statusLine('success', `${actionDescription} simulated successfully.`),
      ...warnings.map((w) => statusLine('warning' as const, w)),
    ];

    return toolResponse(events);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `${LOG_PREFIX}/${toolName}: Failed - ${errorMessage}`);
    if (error instanceof DependencyError) {
      return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
    } else if (error instanceof AxeError) {
      return toolResponse([
        headerEvent,
        statusLine(
          'error',
          `Failed to simulate ${actionDescription.toLowerCase()}: ${error.message}`,
        ),
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
      statusLine('error', `An unexpected error occurred: ${errorMessage}`),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseTapSchema,
});

export const handler = createSessionAwareTool<TapParams>({
  internalSchema: tapSchema as unknown as z.ZodType<TapParams, unknown>,
  logicFunction: (params: TapParams, executor: CommandExecutor) =>
    tapLogic(params, executor, {
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
  } catch (error: unknown) {
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
