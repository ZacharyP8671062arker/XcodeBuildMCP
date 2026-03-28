import { execSync } from 'node:child_process';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import { ensureSimulatorBooted } from '../harness.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const INVALID_SIMULATOR_ID = '00000000-0000-0000-0000-000000000000';

describe('ui-automation workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = createFlowdeckHarness();

    harness.run([
      'run', '-w', WORKSPACE, '-s', 'CalculatorApp', '-S', simulatorUdid,
    ]);

    try {
      execSync(`xcrun simctl launch ${simulatorUdid} ${BUNDLE_ID}`, { encoding: 'utf8' });
    } catch {
      // App may already be running
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('snapshot-ui', () => {
    it('success - calculator app', () => {
      const result = harness.run([
        'ui', 'simulator', 'screen', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'snapshot-ui--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'screen', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'snapshot-ui--error-no-simulator', result.text);
    });
  });

  describe('tap', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'tap', '--point', '100,400', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'tap--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'tap', '--point', '100,100', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'tap--error-no-simulator', result.text);
    });
  });

  describe('touch', () => {
    it('success', () => {
      const downResult = harness.run([
        'ui', 'simulator', 'touch', 'down', '100,400', '-S', simulatorUdid,
      ]);
      const upResult = harness.run([
        'ui', 'simulator', 'touch', 'up', '100,400', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'touch--success', downResult.text + upResult.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'touch', 'down', '100,400', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'touch--error-no-simulator', result.text);
    });
  });

  describe('long-press', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'tap', '--point', '100,400', '--duration', '0.5',
        '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'long-press--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'tap', '--point', '100,400', '--duration', '0.5',
        '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'long-press--error-no-simulator', result.text);
    });
  });

  describe('swipe', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'swipe', '--from', '200,400', '--to', '200,200',
        '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'swipe--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'swipe', '--from', '200,400', '--to', '200,200',
        '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'swipe--error-no-simulator', result.text);
    });
  });

  describe('gesture (scroll-down)', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'scroll', '--direction', 'DOWN',
        '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'gesture--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'scroll', '--direction', 'DOWN',
        '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'gesture--error-no-simulator', result.text);
    });
  });

  describe('button', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'button', 'home', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'button--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'button', 'home', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'button--error-no-simulator', result.text);
    });
  });

  describe('key-press', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'key', '4', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'key-press--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'key', '4', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'key-press--error-no-simulator', result.text);
    });
  });

  describe('key-sequence', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'key', '--sequence', '4,5,6', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'key-sequence--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'key', '--sequence', '4,5,6', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'key-sequence--error-no-simulator', result.text);
    });
  });

  describe('type-text', () => {
    it('success', () => {
      const result = harness.run([
        'ui', 'simulator', 'type', 'hello', '-S', simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'type-text--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui', 'simulator', 'type', 'hello', '-S', INVALID_SIMULATOR_ID,
      ]);
      writeFlowdeckFixture(__filename, 'type-text--error-no-simulator', result.text);
    });
  });
});
