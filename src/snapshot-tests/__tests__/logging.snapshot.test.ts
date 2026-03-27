import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createSnapshotHarness, ensureSimulatorBooted } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DEVICE_ID = process.env.DEVICE_ID;
const BUNDLE_ID = 'io.sentry.calculatorapp';

function extractSessionId(stdout: string): string {
  const line = stdout.split('\n').find((l) => l.includes('Session ID:'));
  const match = line?.match(UUID_PATTERN);
  return match![0];
}

describe('logging workflow', () => {
  let harness: SnapshotHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = await createSnapshotHarness();
  }, 30_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('start-simulator-log-capture', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('logging', 'start-simulator-log-capture', {
        simulatorId: simulatorUdid,
        bundleId: BUNDLE_ID,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'start-sim-log--success');
    }, 30_000);


  });

  describe('stop-simulator-log-capture', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('logging', 'stop-simulator-log-capture', {
        logSessionId: 'nonexistent-session-id',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'stop-sim-log--error');
    }, 30_000);

    it('success', async () => {
      const { VITEST, NODE_ENV, ...cleanEnv } = process.env;

      const startArgs = JSON.stringify({
        simulatorId: simulatorUdid,
        bundleId: BUNDLE_ID,
      });
      const rawStart = spawnSync(
        'node',
        [CLI_PATH, 'logging', 'start-simulator-log-capture', '--json', startArgs],
        { encoding: 'utf8', timeout: 30_000, cwd: process.cwd(), env: cleanEnv },
      );
      expect(rawStart.status).toBe(0);

      const sessionId = extractSessionId(rawStart.stdout);
      expect(sessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const { text, isError } = await harness.invoke('logging', 'stop-simulator-log-capture', {
        logSessionId: sessionId,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'stop-sim-log--success');
    }, 30_000);
  });

  describe('start-device-log-capture', () => {
    it('error - invalid device', async () => {
      const { text, isError } = await harness.invoke('logging', 'start-device-log-capture', {
        deviceId: '00000000-0000-0000-0000-000000000000',
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'start-device-log--error');
    }, 30_000);
  });

  describe('stop-device-log-capture', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('logging', 'stop-device-log-capture', {
        logSessionId: 'nonexistent-session-id',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'stop-device-log--error');
    }, 30_000);
  });

  describe.runIf(DEVICE_ID)('start-device-log-capture (requires device)', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('logging', 'start-device-log-capture', {
        deviceId: DEVICE_ID,
        bundleId: BUNDLE_ID,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'start-device-log--success');
    }, 60_000);
  });

  describe.runIf(DEVICE_ID)('stop-device-log-capture (requires device)', () => {
    it('success', async () => {
      const { VITEST, NODE_ENV, ...cleanEnv } = process.env;

      const startArgs = JSON.stringify({ deviceId: DEVICE_ID, bundleId: BUNDLE_ID });
      const rawStart = spawnSync(
        'node',
        [CLI_PATH, 'logging', 'start-device-log-capture', '--json', startArgs],
        { encoding: 'utf8', timeout: 60_000, cwd: process.cwd(), env: cleanEnv },
      );
      expect(rawStart.status).toBe(0);

      const sessionId = extractSessionId(rawStart.stdout);
      expect(sessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 3000));

      const { text, isError } = await harness.invoke('logging', 'stop-device-log-capture', {
        logSessionId: sessionId,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'stop-device-log--success');
    }, 60_000);
  });
});
