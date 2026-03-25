import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness, ensureSimulatorBooted } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

describe('simulator-management workflow', () => {
  let harness: SnapshotHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('list', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'list', {});
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'list--success');
    });
  });

  describe('boot', () => {
    it('error - invalid id', async () => {
      const { text } = await harness.invoke('simulator-management', 'boot', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
      });
      expectMatchesFixture(text, __filename, 'boot--error-invalid-id');
    });
  });

  describe('open', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'open', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'open--success');
    });
  });

  describe('set-appearance', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-appearance', {
        simulatorId: simulatorUdid,
        mode: 'dark',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'set-appearance--success');
    });
  });

  describe('set-location', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'set-location', {
        simulatorId: simulatorUdid,
        latitude: 37.7749,
        longitude: -122.4194,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'set-location--success');
    });
  });

  describe('reset-location', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'reset-location', {
        simulatorId: simulatorUdid,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'reset-location--success');
    });
  });

  describe('statusbar', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('simulator-management', 'statusbar', {
        simulatorId: simulatorUdid,
        dataNetwork: 'wifi',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'statusbar--success');
    });
  });

  describe('erase', () => {
    it.skip('destructive - erases simulator content', () => {});
  });
});
