import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('device workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('build', () => {
    it(
      'success',
      async () => {
        const { text, isError } = await harness.invoke('device', 'build', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectMatchesFixture(text, __filename, 'build--success');
      },
      { timeout: 120000 },
    );
  });

  describe('get-app-path', () => {
    it(
      'success',
      async () => {
        const { text, isError } = await harness.invoke('device', 'get-app-path', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectMatchesFixture(text, __filename, 'get-app-path--success');
      },
      { timeout: 120000 },
    );
  });

  describe('list', () => {
    it(
      'success',
      async () => {
        const { text, isError } = await harness.invoke('device', 'list', {});
        expect(isError).toBe(false);
        expectMatchesFixture(text, __filename, 'list--success');
      },
      { timeout: 120000 },
    );
  });

  describe.runIf(process.env.DEVICE_ID)('build-and-run (requires device)', () => {
    it(
      'success',
      async () => {
        const { text, isError } = await harness.invoke('device', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: process.env.DEVICE_ID,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectMatchesFixture(text, __filename, 'build-and-run--success');
      },
      { timeout: 120000 },
    );
  });

  describe.runIf(process.env.DEVICE_ID)('test (requires device)', () => {
    it(
      'success',
      async () => {
        const { text, isError } = await harness.invoke('device', 'test', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          deviceId: process.env.DEVICE_ID,
        });
        expect(text.length).toBeGreaterThan(10);
        expectMatchesFixture(text, __filename, 'test--success');
      },
      { timeout: 120000 },
    );
  });

  describe.runIf(process.env.DEVICE_ID)('install (requires device)', () => {
    it.skip('success - requires dynamic built app path', async () => {});
  });

  describe.runIf(process.env.DEVICE_ID)('launch (requires device)', () => {
    it.skip('success - requires installed app', async () => {});
  });

  describe.runIf(process.env.DEVICE_ID)('stop (requires device)', () => {
    it.skip('success - requires running app', async () => {});
  });

  describe.runIf(process.env.DEVICE_ID)('start-device-log-capture (requires device)', () => {
    it.skip('success - requires running app', async () => {});
  });

  describe.runIf(process.env.DEVICE_ID)('stop-device-log-capture (requires device)', () => {
    it.skip('success - requires active log session', async () => {});
  });
});
