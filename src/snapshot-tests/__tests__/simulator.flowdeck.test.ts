import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';
import { ensureSimulatorBooted } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('simulator workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = createFlowdeckHarness();
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('build', () => {
    it('success', () => {
      const result = harness.run([
        'build',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'build--success', result.text);
    }, 120_000);

    it('error - wrong scheme', () => {
      const result = harness.run([
        'build',
        '-w',
        WORKSPACE,
        '-s',
        'NONEXISTENT',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'build--error-wrong-scheme', result.text);
    }, 120_000);
  });

  describe('build-and-run', () => {
    it('success', () => {
      const result = harness.run([
        'run',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'build-and-run--success', result.text);
    }, 120_000);

    it('error - wrong scheme', () => {
      const result = harness.run([
        'run',
        '-w',
        WORKSPACE,
        '-s',
        'NONEXISTENT',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'build-and-run--error-wrong-scheme', result.text);
    }, 120_000);
  });

  describe('test', () => {
    it('success', () => {
      const result = harness.run([
        'test',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
        '--only',
        'CalculatorAppTests/CalculatorAppTests/testAddition',
      ]);
      writeFlowdeckFixture(__filename, 'test--success', result.text);
    }, 120_000);

    it('failure - intentional test failure', () => {
      const result = harness.run([
        'test',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'test--failure', result.text);
    }, 120_000);

    it('error - wrong scheme', () => {
      const result = harness.run([
        'test',
        '-w',
        WORKSPACE,
        '-s',
        'NONEXISTENT',
        '-S',
        simulatorUdid,
      ]);
      writeFlowdeckFixture(__filename, 'test--error-wrong-scheme', result.text);
    }, 120_000);
  });

  describe('list', () => {
    it('success', () => {
      const result = harness.run(['simulator', 'list']);
      writeFlowdeckFixture(__filename, 'list--success', result.text);
    }, 120_000);
  });

  describe('install', () => {
    it('success', () => {
      const settingsOutput = execSync(
        `xcodebuild -workspace ${WORKSPACE} -scheme CalculatorApp -showBuildSettings -destination 'platform=iOS Simulator,name=iPhone 17' 2>/dev/null`,
        { encoding: 'utf8' },
      );
      const match = settingsOutput.match(/BUILT_PRODUCTS_DIR = (.+)/);
      const appPath = `${match![1]!.trim()}/CalculatorApp.app`;

      const result = harness.run(['uninstall', 'io.sentry.calculatorapp', '-s', simulatorUdid]);
      // Reinstall by running
      const installResult = harness.run([
        'run',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
        '--no-build',
      ]);
      writeFlowdeckFixture(__filename, 'install--success', installResult.text);
    }, 120_000);

    it('error - invalid app', () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sim-install-'));
      const fakeApp = path.join(tmpDir, 'NotAnApp.app');
      fs.mkdirSync(fakeApp);
      try {
        // flowdeck doesn't have a direct install-to-sim command
        // The closest is run --no-build which will fail with invalid app
        const result = harness.run(['run', '-w', fakeApp, '-S', simulatorUdid, '--no-build']);
        writeFlowdeckFixture(__filename, 'install--error-invalid-app', result.text);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 120_000);
  });

  describe('launch-app', () => {
    it('success', () => {
      const result = harness.run([
        'run',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
        '--no-build',
      ]);
      writeFlowdeckFixture(__filename, 'launch-app--success', result.text);
    }, 120_000);
  });

  describe('screenshot', () => {
    it('success', () => {
      const result = harness.run(['ui', 'simulator', 'screen', '-S', simulatorUdid]);
      writeFlowdeckFixture(__filename, 'screenshot--success', result.text);
    }, 120_000);

    it('error - invalid simulator', () => {
      const result = harness.run([
        'ui',
        'simulator',
        'screen',
        '-S',
        '00000000-0000-0000-0000-000000000000',
      ]);
      writeFlowdeckFixture(__filename, 'screenshot--error-invalid-simulator', result.text);
    }, 120_000);
  });

  describe('stop', () => {
    it('success', () => {
      const runResult = harness.run([
        'run',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-S',
        simulatorUdid,
        '--no-build',
      ]);
      const appIdMatch = runResult.text.match(/App ID: ([A-F0-9]+)/);
      const appId = appIdMatch ? appIdMatch[1] : 'io.sentry.calculatorapp';

      const result = harness.run(['stop', appId]);
      writeFlowdeckFixture(__filename, 'stop--success', result.text);
    }, 120_000);

    it('error - no app', () => {
      const result = harness.run(['stop', 'com.nonexistent.app']);
      writeFlowdeckFixture(__filename, 'stop--error-no-app', result.text);
    }, 120_000);
  });
});
