import { log } from './logging/index.ts';
import type { CommandExecutor } from './CommandExecutor.ts';
import { normalizeSimctlChildEnv } from './environment.ts';

export interface StepResult {
  success: boolean;
  error?: string;
}

export interface LaunchStepResult extends StepResult {
  processId?: number;
}

export interface SimulatorInfo {
  udid: string;
  name: string;
  state: string;
}

/**
 * Find a simulator by UUID and return its current state.
 */
export async function findSimulatorById(
  simulatorId: string,
  executor: CommandExecutor,
): Promise<{ simulator: SimulatorInfo | null; error?: string }> {
  const listResult = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List Simulators',
  );
  if (!listResult.success) {
    return { simulator: null, error: listResult.error ?? 'Failed to list simulators' };
  }

  const simulatorsData = JSON.parse(listResult.output) as {
    devices: Record<string, unknown[]>;
  };

  for (const runtime in simulatorsData.devices) {
    const devices = simulatorsData.devices[runtime];
    if (Array.isArray(devices)) {
      for (const device of devices) {
        if (
          typeof device === 'object' &&
          device !== null &&
          'udid' in device &&
          'name' in device &&
          'state' in device &&
          typeof device.udid === 'string' &&
          typeof device.name === 'string' &&
          typeof device.state === 'string' &&
          device.udid === simulatorId
        ) {
          return {
            simulator: { udid: device.udid, name: device.name, state: device.state },
          };
        }
      }
    }
  }

  return { simulator: null };
}

/**
 * Install an app on a simulator.
 */
export async function installAppOnSimulator(
  simulatorId: string,
  appPath: string,
  executor: CommandExecutor,
): Promise<StepResult> {
  log('info', `Installing app at path: ${appPath} to simulator: ${simulatorId}`);
  const result = await executor(
    ['xcrun', 'simctl', 'install', simulatorId, appPath],
    'Install App in Simulator',
    false,
  );
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to install app' };
  }
  return { success: true };
}

/**
 * Launch an app on a simulator and return the process ID if available.
 */
export async function launchSimulatorApp(
  simulatorId: string,
  bundleId: string,
  executor: CommandExecutor,
  opts?: { args?: string[]; env?: Record<string, string> },
): Promise<LaunchStepResult> {
  log('info', `Launching app with bundle ID: ${bundleId} on simulator: ${simulatorId}`);
  const command = ['xcrun', 'simctl', 'launch', simulatorId, bundleId];
  if (opts?.args?.length) {
    command.push(...opts.args);
  }

  const execOpts = opts?.env ? { env: normalizeSimctlChildEnv(opts.env) } : undefined;
  const result = await executor(command, 'Launch App', false, execOpts);
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to launch app' };
  }

  const pidMatch = result.output?.match(/:\s*(\d+)\s*$/);
  const processId = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
  return { success: true, processId };
}
