import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const DEVICE_ID = process.env.DEVICE_ID;

describe('device workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = await createSnapshotHarness();
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('list', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('device', 'list', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'list--success');
    });
  });

  describe('build', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('device', 'build', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build--success');
    });

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('device', 'build', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'build--error-wrong-scheme');
    });
  });

  describe('get-app-path', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('device', 'get-app-path', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'get-app-path--success');
    });

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('device', 'get-app-path', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'get-app-path--error-wrong-scheme');
    });
  });

  describe('install', () => {
    it('error - invalid app path', async () => {
      const { text, isError } = await harness.invoke('device', 'install', {
        deviceId: '00000000-0000-0000-0000-000000000000',
        appPath: '/tmp/nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'install--error-invalid-app');
    });
  });

  describe('launch', () => {
    it('error - invalid bundle', async () => {
      const { text, isError } = await harness.invoke('device', 'launch', {
        deviceId: '00000000-0000-0000-0000-000000000000',
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'launch--error-invalid-bundle');
    });
  });

  describe('stop', () => {
    it('error - no app', async () => {
      const { text, isError } = await harness.invoke('device', 'stop', {
        deviceId: '00000000-0000-0000-0000-000000000000',
        processId: 99999,
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'stop--error-no-app');
    });
  });

  describe.runIf(DEVICE_ID)('build-and-run (requires device)', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('device', 'build-and-run', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        deviceId: DEVICE_ID,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build-and-run--success');
    });
  });

  describe.runIf(DEVICE_ID)('test (requires device)', () => {
    it('failure - intentional test failure', async () => {
      const { text, isError } = await harness.invoke('device', 'test', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        deviceId: DEVICE_ID,
      });
      expect(isError).toBe(true);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'test--failure');
    }, 300_000);
  });
});
