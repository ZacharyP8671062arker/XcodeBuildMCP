import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const PROJECT = 'example_projects/macOS/MCPTest.xcodeproj';

describe('macos workflow', () => {
  let harness: SnapshotHarness;
  let tmpDir: string;
  let fakeAppPath: string;
  let bundleIdAppPath: string;

  beforeAll(async () => {
    harness = await createSnapshotHarness();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-snapshot-'));

    fakeAppPath = path.join(tmpDir, 'Fake.app');
    fs.mkdirSync(fakeAppPath);

    bundleIdAppPath = path.join(tmpDir, 'BundleTest.app');
    fs.mkdirSync(bundleIdAppPath);
    fs.writeFileSync(
      path.join(bundleIdAppPath, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.snapshot-macos</string>
</dict>
</plist>`,
    );
  });

  afterAll(() => {
    harness.cleanup();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('build', () => {
    it('success', { timeout: 120000 }, async () => {
      const { text, isError } = await harness.invoke('macos', 'build', {
        projectPath: PROJECT,
        scheme: 'MCPTest',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build--success');
    });
  });

  describe('build-and-run', () => {
    it('success', { timeout: 120000 }, async () => {
      const { text, isError } = await harness.invoke('macos', 'build-and-run', {
        projectPath: PROJECT,
        scheme: 'MCPTest',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'build-and-run--success');
    });
  });

  describe('test', () => {
    it('success', { timeout: 120000 }, async () => {
      const { text, isError } = await harness.invoke('macos', 'test', {
        projectPath: PROJECT,
        scheme: 'MCPTest',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'test--success');
    });
  });

  describe('get-app-path', () => {
    it('success', { timeout: 120000 }, async () => {
      const { text, isError } = await harness.invoke('macos', 'get-app-path', {
        projectPath: PROJECT,
        scheme: 'MCPTest',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'get-app-path--success');
    });
  });

  describe('launch', () => {
    it('error - invalid app', { timeout: 120000 }, async () => {
      const { text } = await harness.invoke('macos', 'launch', {
        appPath: fakeAppPath,
      });
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'launch--error-invalid-app');
    });
  });

  describe('stop', () => {
    it('error - no app', { timeout: 120000 }, async () => {
      const { text } = await harness.invoke('macos', 'stop', {
        appName: 'NonExistentXBMTestApp',
      });
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'stop--error-no-app');
    });
  });

  describe('get-macos-bundle-id', () => {
    it('success', { timeout: 120000 }, async () => {
      const { text } = await harness.invoke('macos', 'get-macos-bundle-id', {
        appPath: bundleIdAppPath,
      });
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'get-macos-bundle-id--success');
    });
  });
});
