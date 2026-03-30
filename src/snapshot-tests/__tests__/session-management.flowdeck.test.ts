import { describe, it, beforeAll, afterAll } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('session-management workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;

  beforeAll(() => {
    harness = createFlowdeckHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('session-set-defaults', () => {
    it('success', () => {
      // flowdeck equivalent: config set
      const result = harness.run(['config', 'set', '-w', WORKSPACE, '-s', 'CalculatorApp']);
      writeFlowdeckFixture(__filename, 'session-set-defaults--success', result.text);
    });
  });

  describe('session-show-defaults', () => {
    it('success', () => {
      // flowdeck equivalent: config get
      const result = harness.run(['config', 'get']);
      writeFlowdeckFixture(__filename, 'session-show-defaults--success', result.text);
    });
  });

  describe('session-clear-defaults', () => {
    it('success', () => {
      // flowdeck equivalent: config reset
      const result = harness.run(['config', 'reset']);
      writeFlowdeckFixture(__filename, 'session-clear-defaults--success', result.text);
    });
  });

  describe('session-use-defaults-profile', () => {
    // flowdeck doesn't have a direct profile concept
    it.skip('no direct flowdeck equivalent', () => {});
  });

  describe('session-sync-xcode-defaults', () => {
    // flowdeck's project sync-profiles is the closest
    it('success', () => {
      const result = harness.run(['context']);
      writeFlowdeckFixture(__filename, 'session-sync-xcode-defaults--success', result.text);
    });
  });
});
