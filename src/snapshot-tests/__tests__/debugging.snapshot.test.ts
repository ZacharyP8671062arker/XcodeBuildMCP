import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

describe('debugging workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('continue', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'continue', {});
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'continue--error-no-session');
    }, 30_000);
  });

  describe('detach', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'detach', {});
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'detach--error-no-session');
    }, 30_000);
  });

  describe('stack', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'stack', {});
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'stack--error-no-session');
    }, 30_000);
  });

  describe('variables', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'variables', {});
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'variables--error-no-session');
    }, 30_000);
  });

  describe('add-breakpoint', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'add-breakpoint', {
        file: 'test.swift',
        line: 1,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'add-breakpoint--error-no-session');
    }, 30_000);
  });

  describe('remove-breakpoint', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'remove-breakpoint', {
        breakpointId: 1,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'remove-breakpoint--error-no-session');
    }, 30_000);
  });

  describe('lldb-command', () => {
    it('error - no session', async () => {
      const { text, isError } = await harness.invoke('debugging', 'lldb-command', {
        command: 'bt',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'lldb-command--error-no-session');
    }, 30_000);
  });

  describe('attach', () => {
    it('error - no process', async () => {
      const { text, isError } = await harness.invoke('debugging', 'attach', {
        simulatorId: '00000000-0000-0000-0000-000000000000',
        bundleId: 'com.nonexistent.app',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'attach--error-no-process');
    }, 30_000);
  });
});
