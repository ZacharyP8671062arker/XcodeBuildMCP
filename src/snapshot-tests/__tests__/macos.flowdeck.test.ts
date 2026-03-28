import { describe, it, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const PROJECT = 'example_projects/macOS/MCPTest.xcodeproj';

describe('macos workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let tmpDir: string;

  beforeAll(() => {
    harness = createFlowdeckHarness();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-macos-snapshot-'));
  });

  afterAll(() => {
    harness.cleanup();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('build', () => {
    it('success', { timeout: 120000 }, () => {
      const result = harness.run([
        'build', '-w', PROJECT, '-s', 'MCPTest', '-S', 'none',
      ]);
      writeFlowdeckFixture(__filename, 'build--success', result.text);
    });

    it('error - wrong scheme', { timeout: 120000 }, () => {
      const result = harness.run([
        'build', '-w', PROJECT, '-s', 'NONEXISTENT', '-S', 'none',
      ]);
      writeFlowdeckFixture(__filename, 'build--error-wrong-scheme', result.text);
    });
  });

  describe('build-and-run', () => {
    it('success', { timeout: 120000 }, () => {
      const result = harness.run([
        'run', '-w', PROJECT, '-s', 'MCPTest', '-S', 'none',
      ]);
      writeFlowdeckFixture(__filename, 'build-and-run--success', result.text);
    });

    it('error - wrong scheme', { timeout: 120000 }, () => {
      const result = harness.run([
        'run', '-w', PROJECT, '-s', 'NONEXISTENT', '-S', 'none',
      ]);
      writeFlowdeckFixture(__filename, 'build-and-run--error-wrong-scheme', result.text);
    });
  });

  describe('test', () => {
    it('success', { timeout: 120000 }, () => {
      const result = harness.run([
        'test', '-w', PROJECT, '-s', 'MCPTest', '-D', 'My Mac',
        '--only', 'MCPTestTests/MCPTestTests/appNameIsCorrect',
      ]);
      writeFlowdeckFixture(__filename, 'test--success', result.text);
    });

    it('failure - intentional test failure', { timeout: 120000 }, () => {
      const result = harness.run([
        'test', '-w', PROJECT, '-s', 'MCPTest', '-D', 'My Mac',
      ]);
      writeFlowdeckFixture(__filename, 'test--failure', result.text);
    });

    it('error - wrong scheme', { timeout: 120000 }, () => {
      const result = harness.run([
        'test', '-w', PROJECT, '-s', 'NONEXISTENT', '-D', 'My Mac',
      ]);
      writeFlowdeckFixture(__filename, 'test--error-wrong-scheme', result.text);
    });
  });

  describe('stop', () => {
    it('success', { timeout: 120000 }, () => {
      const runResult = harness.run([
        'run', '-w', PROJECT, '-s', 'MCPTest', '-S', 'none',
      ]);
      const appIdMatch = runResult.text.match(/App ID: ([A-F0-9]+)/);
      const appId = appIdMatch ? appIdMatch[1] : 'io.sentry.MCPTest';

      const result = harness.run(['stop', appId]);
      writeFlowdeckFixture(__filename, 'stop--success', result.text);
    });

    it('error - no app', { timeout: 120000 }, () => {
      const result = harness.run(['stop', 'com.nonexistent.app']);
      writeFlowdeckFixture(__filename, 'stop--error-no-app', result.text);
    });
  });

  describe('clean', () => {
    it('success', { timeout: 120000 }, () => {
      const result = harness.run([
        'clean', '-w', PROJECT, '-s', 'MCPTest',
      ]);
      writeFlowdeckFixture(__filename, 'clean--success', result.text);
    });
  });
});
