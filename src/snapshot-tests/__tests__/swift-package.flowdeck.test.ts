import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

describe('swift-package workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;

  beforeAll(() => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = createFlowdeckHarness();
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  // flowdeck doesn't support raw Swift Package Manager directories.
  // Its build/test/clean commands require an Xcode project or workspace.
  describe('build', () => {
    it.skip('flowdeck requires Xcode project, not raw SPM directory', () => {});
  });

  describe('test', () => {
    it.skip('flowdeck requires Xcode project, not raw SPM directory', () => {});
  });

  describe('clean', () => {
    it.skip('flowdeck requires Xcode project, not raw SPM directory', () => {});
  });

  describe('run', () => {
    it.skip('flowdeck has no SPM executable run equivalent', () => {});
  });

  describe('list', () => {
    it('success', () => {
      const result = harness.run(['apps']);
      writeFlowdeckFixture(__filename, 'list--success', result.text);
    });
  });

  describe('stop', () => {
    it('error - no process', () => {
      const result = harness.run(['stop', 'com.nonexistent.spm.app']);
      writeFlowdeckFixture(__filename, 'stop--error-no-process', result.text);
    });
  });
});
