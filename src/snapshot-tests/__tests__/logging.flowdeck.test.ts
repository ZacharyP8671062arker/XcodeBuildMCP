import { describe, it, beforeAll, afterAll } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import { ensureSimulatorBooted } from '../harness.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';

describe('logging workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = createFlowdeckHarness();

    // Ensure app is running for log capture
    harness.run(['run', '-w', WORKSPACE, '-s', 'CalculatorApp', '-S', simulatorUdid]);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('logs', () => {
    it('success - stream logs (brief capture)', () => {
      // flowdeck logs streams continuously; we capture briefly with a timeout
      const { spawnSync } = require('node:child_process');
      const result = spawnSync('flowdeck', ['logs', BUNDLE_ID], {
        encoding: 'utf8',
        timeout: 5_000,
        cwd: process.cwd(),
      });
      const text = (result.stdout ?? '') + (result.stderr ?? '');
      writeFlowdeckFixture(__filename, 'logs--success', text);
    }, 30_000);
  });

  // flowdeck doesn't have start/stop log capture sessions like XcodeBuildMCP
  // It only has a streaming `logs` command
  describe('start-device-log-capture', () => {
    it.skip('flowdeck uses streaming logs, no start/stop session model', () => {});
  });

  describe('stop-device-log-capture', () => {
    it.skip('flowdeck uses streaming logs, no start/stop session model', () => {});
  });
});
