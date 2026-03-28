import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FlowdeckResult {
  text: string;
  isError: boolean;
}

export interface FlowdeckHarness {
  run(args: string[]): FlowdeckResult;
  cleanup(): void;
}

const PTY_HELPER = join(fileURLToPath(import.meta.url), '..', 'flowdeck-pty.py');

export function createFlowdeckHarness(): FlowdeckHarness {
  function run(args: string[]): FlowdeckResult {
    const result = spawnSync('python3', [PTY_HELPER, ...args], {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: process.cwd(),
    });

    const text = result.stdout ?? '';

    return {
      text,
      isError: result.status !== 0,
    };
  }

  function cleanup(): void {}

  return { run, cleanup };
}
