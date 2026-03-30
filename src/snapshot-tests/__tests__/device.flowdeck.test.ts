import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';

function findDevice(): string | undefined {
  if (process.env.DEVICE_ID) return process.env.DEVICE_ID;
  try {
    const output = execSync('flowdeck device list --json', {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const devices = JSON.parse(output);
    for (const device of devices) {
      if (device.platform === 'iOS' && !device.isVirtual && device.isAvailable) {
        return device.udid;
      }
    }
  } catch {
    /* no device available */
  }
  return undefined;
}

const deviceId = findDevice();

describe('device workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;

  beforeAll(() => {
    vi.setConfig({ testTimeout: 120_000 });
    harness = createFlowdeckHarness();
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
  });

  describe('list', () => {
    it('success', () => {
      const result = harness.run(['device', 'list']);
      writeFlowdeckFixture(__filename, 'list--success', result.text);
    });
  });

  describe('build', () => {
    it.runIf(deviceId)('success', () => {
      const result = harness.run([
        'build',
        '-w',
        WORKSPACE,
        '-s',
        'CalculatorApp',
        '-D',
        deviceId!,
      ]);
      writeFlowdeckFixture(__filename, 'build--success', result.text);
    });

    it.runIf(deviceId)('error - wrong scheme', () => {
      const result = harness.run(['build', '-w', WORKSPACE, '-s', 'NONEXISTENT', '-D', deviceId!]);
      writeFlowdeckFixture(__filename, 'build--error-wrong-scheme', result.text);
    });
  });

  describe('build-and-run', () => {
    it.runIf(deviceId)('success', () => {
      const result = harness.run(['run', '-w', WORKSPACE, '-s', 'CalculatorApp', '-D', deviceId!]);
      writeFlowdeckFixture(__filename, 'build-and-run--success', result.text);
    });
  });

  describe('install', () => {
    it('error - invalid app path', () => {
      const result = harness.run([
        'device',
        'install',
        '00000000-0000-0000-0000-000000000000',
        '/tmp/nonexistent.app',
      ]);
      writeFlowdeckFixture(__filename, 'install--error-invalid-app', result.text);
    });

    it.runIf(deviceId)('success', () => {
      const result = harness.run(['device', 'install', deviceId!, '/tmp/nonexistent-device.app']);
      writeFlowdeckFixture(__filename, 'install--success-attempt', result.text);
    });
  });

  describe('launch', () => {
    it('error - invalid bundle', () => {
      const result = harness.run([
        'device',
        'launch',
        '00000000-0000-0000-0000-000000000000',
        'com.nonexistent.app',
      ]);
      writeFlowdeckFixture(__filename, 'launch--error-invalid-bundle', result.text);
    });

    it.runIf(deviceId)(
      'success',
      () => {
        const result = harness.run(['device', 'launch', deviceId!, BUNDLE_ID]);
        writeFlowdeckFixture(__filename, 'launch--success', result.text);
      },
      60_000,
    );
  });

  describe('stop', () => {
    it('error - no app', () => {
      const result = harness.run(['stop', 'com.nonexistent.app']);
      writeFlowdeckFixture(__filename, 'stop--error-no-app', result.text);
    });

    it.runIf(deviceId)(
      'success',
      () => {
        const runResult = harness.run([
          'run',
          '-w',
          WORKSPACE,
          '-s',
          'CalculatorApp',
          '-D',
          deviceId!,
        ]);
        const appIdMatch = runResult.text.match(/App ID: ([A-F0-9]+)/);
        const appId = appIdMatch ? appIdMatch[1] : BUNDLE_ID;

        const result = harness.run(['stop', appId]);
        writeFlowdeckFixture(__filename, 'stop--success', result.text);
      },
      120_000,
    );
  });

  describe('test', () => {
    it.runIf(deviceId)(
      'success - targeted passing test',
      () => {
        const result = harness.run([
          'test',
          '-w',
          WORKSPACE,
          '-s',
          'CalculatorApp',
          '-D',
          deviceId!,
          '--only',
          'CalculatorAppTests/CalculatorAppTests/testAddition',
        ]);
        writeFlowdeckFixture(__filename, 'test--success', result.text);
      },
      300_000,
    );

    it.runIf(deviceId)(
      'failure - intentional test failure',
      () => {
        const result = harness.run([
          'test',
          '-w',
          WORKSPACE,
          '-s',
          'CalculatorApp',
          '-D',
          deviceId!,
        ]);
        writeFlowdeckFixture(__filename, 'test--failure', result.text);
      },
      300_000,
    );
  });
});
