import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

describe('workflow-discovery workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('manage-workflows', () => {
    it.skip('requires MCP runtime (tool registry must be initialized)', async () => {});
  });
});
