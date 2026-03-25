import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const ENABLED = !!process.env.SNAPSHOT_XCODE_IDE;

describe.skipIf(!ENABLED)('xcode-ide workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  }, 30000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('list-tools', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('xcode-ide', 'list-tools', {});
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'list-tools--success');
    }, 30000);
  });

  describe('call-tool', () => {
    it('error - unknown tool', async () => {
      const { text, isError } = await harness.invoke('xcode-ide', 'call-tool', {
        remoteTool: 'nonexistent',
      });
      expect(isError).toBe(true);
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'call-tool--error-unknown-tool');
    }, 60000);
  });

  describe('bridge-status', () => {
    it('success', async () => {
      const { text } = await harness.invoke('xcode-ide', 'bridge-status', {});
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'bridge-status--success');
    }, 30000);
  });

  describe('bridge-sync', () => {
    it('success', async () => {
      const { text } = await harness.invoke('xcode-ide', 'bridge-sync', {});
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'bridge-sync--success');
    }, 60000);
  });

  describe('bridge-disconnect', () => {
    it('success', async () => {
      const { text } = await harness.invoke('xcode-ide', 'bridge-disconnect', {});
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'bridge-disconnect--success');
    }, 30000);
  });
});
