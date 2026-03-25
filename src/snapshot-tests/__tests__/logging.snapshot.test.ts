import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

describe('logging workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('start-simulator-log-capture', () => {
    it('error - invalid session params', async () => {
      const { text } = await harness.invoke('logging', 'start-simulator-log-capture', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        bundleId: 'com.nonexistent.app',
      });
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'start-sim-log--error');
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
  });
});
