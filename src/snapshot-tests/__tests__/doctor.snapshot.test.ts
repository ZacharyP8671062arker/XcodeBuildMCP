import { describe, it, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import type { SnapshotHarness } from '../harness.ts';

describe('doctor workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('doctor', () => {
    it.skip('not exposed as CLI command; output is heavily dynamic (versions, paths)', async () => {});
  });
});
