import { describe, it, beforeAll, afterAll } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import { ensureSimulatorBooted } from '../harness.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

describe('simulator-management workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = createFlowdeckHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('list', () => {
    it('success', () => {
      const result = harness.run(['simulator', 'list']);
      writeFlowdeckFixture(__filename, 'list--success', result.text);
    });
  });

  describe('boot', () => {
    it('error - invalid id', () => {
      const result = harness.run(['simulator', 'boot', '00000000-0000-0000-0000-000000000000']);
      writeFlowdeckFixture(__filename, 'boot--error-invalid-id', result.text);
    });
  });

  describe('open', () => {
    it('success', () => {
      const result = harness.run(['simulator', 'open']);
      writeFlowdeckFixture(__filename, 'open--success', result.text);
    });
  });

  describe('set-appearance', () => {
    it('success', () => {
      const result = harness.run([
        'ui',
        'simulator',
        'set-appearance',
        'dark',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'set-appearance--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui',
        'simulator',
        'set-appearance',
        'dark',
        '-S',
        '00000000-0000-0000-0000-000000000000',
      ]);
      writeFlowdeckFixture(__filename, 'set-appearance--error-invalid-simulator', result.text);
    });
  });

  describe('set-location', () => {
    it('success', () => {
      const result = harness.run([
        'simulator',
        'location',
        'set',
        '37.7749,-122.4194',
        '--udid',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'set-location--success', result.text);
    });

    it('error - invalid simulator', () => {
      const result = harness.run([
        'simulator',
        'location',
        'set',
        '37.7749,-122.4194',
        '--udid',
        '00000000-0000-0000-0000-000000000000',
      ]);
      writeFlowdeckFixture(__filename, 'set-location--error-invalid-simulator', result.text);
    });
  });

  describe('erase', () => {
    it('error - invalid id', () => {
      const result = harness.run(['simulator', 'erase', '00000000-0000-0000-0000-000000000000']);
      writeFlowdeckFixture(__filename, 'erase--error-invalid-id', result.text);
    });
  });

  describe('statusbar', () => {
    // flowdeck doesn't have a direct statusbar command
    it.skip('no flowdeck equivalent', () => {});
  });

  describe('reset-location', () => {
    // flowdeck doesn't have a reset-location command
    it.skip('no flowdeck equivalent', () => {});
  });
});
