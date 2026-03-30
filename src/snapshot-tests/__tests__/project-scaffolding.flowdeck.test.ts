import { describe, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

describe('project-scaffolding workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let tmpDir: string;

  beforeAll(() => {
    harness = createFlowdeckHarness();
    tmpDir = mkdtempSync(join(tmpdir(), 'fd-scaffold-'));
  });

  afterAll(() => {
    harness.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('scaffold-ios', () => {
    it('success', () => {
      const outputPath = join(tmpDir, 'ios');
      const result = harness.run([
        'project',
        'create',
        'SnapshotTestApp',
        '--platforms',
        'ios',
        '--path',
        outputPath,
      ]);
      writeFlowdeckFixture(__filename, 'scaffold-ios--success', result.text);
    }, 120000);

    it('error - existing project', () => {
      const outputPath = join(tmpDir, 'ios-existing');
      // Create first
      harness.run([
        'project',
        'create',
        'SnapshotTestApp',
        '--platforms',
        'ios',
        '--path',
        outputPath,
      ]);
      // Create again to trigger error
      const result = harness.run([
        'project',
        'create',
        'SnapshotTestApp',
        '--platforms',
        'ios',
        '--path',
        outputPath,
      ]);
      writeFlowdeckFixture(__filename, 'scaffold-ios--error-existing', result.text);
    }, 120000);
  });

  describe('scaffold-macos', () => {
    it('success', () => {
      const outputPath = join(tmpDir, 'macos');
      const result = harness.run([
        'project',
        'create',
        'SnapshotTestMacApp',
        '--platforms',
        'macos',
        '--path',
        outputPath,
      ]);
      writeFlowdeckFixture(__filename, 'scaffold-macos--success', result.text);
    }, 120000);

    it('error - existing project', () => {
      const outputPath = join(tmpDir, 'macos-existing');
      harness.run([
        'project',
        'create',
        'SnapshotTestMacApp',
        '--platforms',
        'macos',
        '--path',
        outputPath,
      ]);
      const result = harness.run([
        'project',
        'create',
        'SnapshotTestMacApp',
        '--platforms',
        'macos',
        '--path',
        outputPath,
      ]);
      writeFlowdeckFixture(__filename, 'scaffold-macos--error-existing', result.text);
    }, 120000);
  });
});
