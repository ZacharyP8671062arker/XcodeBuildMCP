import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { finalizePendingXcodebuildResponse } from '../../../../utils/xcodebuild-output.ts';
import { schema, handler, build_run_deviceLogic } from '../build_run_device.ts';

function expectPendingBuildRunResponse(
  result: Awaited<ReturnType<typeof build_run_deviceLogic>>,
  isError: boolean,
): void {
  expect(result.isError).toBe(isError);
  expect(result.content).toEqual([]);
  expect(result._meta).toEqual(
    expect.objectContaining({
      pendingXcodebuild: expect.objectContaining({
        kind: 'pending-xcodebuild',
      }),
    }),
  );
}

describe('build_run_device tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('exposes only non-session fields in public schema', () => {
      const schemaObj = z.strictObject(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ extraArgs: ['-quiet'] }).success).toBe(true);
      expect(schemaObj.safeParse({ env: { FOO: 'bar' } }).success).toBe(true);

      expect(schemaObj.safeParse({ scheme: 'App' }).success).toBe(false);
      expect(schemaObj.safeParse({ deviceId: 'device-id' }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['env', 'extraArgs']);
    });
  });

  describe('Handler Requirements', () => {
    it('requires scheme + deviceId and project/workspace via handler', async () => {
      const missingAll = await handler({});
      expect(missingAll.isError).toBe(true);
      expect(missingAll.content[0].text).toContain('Provide scheme and deviceId');

      const missingSource = await handler({ scheme: 'MyApp', deviceId: 'DEVICE-UDID' });
      expect(missingSource.isError).toBe(true);
      expect(missingSource.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('Handler Behavior (Pending Pipeline Contract)', () => {
    it('handles build failure as pending error', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed with error',
      });

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextSteps).toBeUndefined();
      expect(result.nextStepParams).toBeUndefined();
      expect(result._meta?.pendingXcodebuild).toEqual(
        expect.objectContaining({
          errorFallbackPolicy: 'if-no-structured-diagnostics',
          tailEvents: [],
        }),
      );
    });

    it('handles build settings failure as pending error', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({ success: false, error: 'no build settings' });
        }
        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextSteps).toBeUndefined();
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles install failure as pending error', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        if (command.includes('install')) {
          return createMockCommandResponse({ success: false, error: 'install failed' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextSteps).toBeUndefined();
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles launch failure as pending error', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        if (command.includes('launch')) {
          return createMockCommandResponse({ success: false, error: 'launch failed' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextSteps).toBeUndefined();
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles successful build, install, and launch', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          existsSync: () => true,
          readFile: async () =>
            JSON.stringify({ result: { process: { processIdentifier: 1234 } } }),
        }),
      );

      expectPendingBuildRunResponse(result, false);
      expect(result.nextStepParams).toMatchObject({
        start_device_log_cap: { deviceId: 'DEVICE-UDID', bundleId: 'io.sentry.MyApp' },
        stop_app_device: { deviceId: 'DEVICE-UDID', processId: 1234 },
      });
      expect(result._meta?.pendingXcodebuild).toEqual(
        expect.objectContaining({
          tailEvents: [
            expect.objectContaining({
              type: 'status-line',
              level: 'success',
              message: 'Build & Run complete',
            }),
            expect.objectContaining({
              type: 'detail-tree',
              items: expect.arrayContaining([
                expect.objectContaining({ label: 'App Path', value: '/tmp/build/MyApp.app' }),
                expect.objectContaining({ label: 'Bundle ID', value: 'io.sentry.MyApp' }),
                expect.objectContaining({ label: 'Process ID', value: '1234' }),
                expect.objectContaining({ label: 'Build Logs', value: expect.stringContaining('build_run_device_') }),
              ]),
            }),
          ],
        }),
      );
    });

    it('succeeds without processId when launch JSON is unparseable', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          existsSync: () => true,
          readFile: async () => 'not-json',
        }),
      );

      expectPendingBuildRunResponse(result, false);
      expect(result.nextStepParams).toMatchObject({
        start_device_log_cap: { deviceId: 'DEVICE-UDID', bundleId: 'io.sentry.MyApp' },
      });
      expect(result.nextStepParams?.stop_app_device).toBeUndefined();

      const tailEvents = (
        result._meta?.pendingXcodebuild as {
          tailEvents: Array<{ type: string; items?: Array<{ label: string; value: string }> }>;
        }
      ).tailEvents;
      expect(tailEvents).toHaveLength(2);
      expect(tailEvents[0].type).toBe('status-line');
      const detailTree = tailEvents[1];
      expect(detailTree.type).toBe('detail-tree');
      expect(detailTree.items?.some((item) => item.label === 'Process ID')).toBe(false);
      expect(detailTree.items?.some((item) => item.label === 'Build Logs')).toBe(true);
    });

    it('uses generic destination for build-settings lookup', async () => {
      const commandCalls: string[][] = [];
      const mockExecutor: CommandExecutor = async (command) => {
        commandCalls.push(command);

        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyWatchApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyWatchApp' });
        }

        if (command.includes('launch')) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({ result: { process: { processIdentifier: 9876 } } }),
          });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyWatchApp.xcodeproj',
          scheme: 'MyWatchApp',
          platform: 'watchOS',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({ existsSync: () => true }),
      );

      expectPendingBuildRunResponse(result, false);

      const showBuildSettingsCommand = commandCalls.find((command) =>
        command.includes('-showBuildSettings'),
      );
      expect(showBuildSettingsCommand).toBeDefined();
      expect(showBuildSettingsCommand).toContain('-destination');

      const destinationIndex = showBuildSettingsCommand!.indexOf('-destination');
      expect(showBuildSettingsCommand![destinationIndex + 1]).toBe('generic/platform=watchOS');
    });

    it('handles spawn error as pending error', async () => {
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        void command;
        void description;
        void logOutput;
        void opts;
        void detached;
        return Promise.reject(new Error('spawn xcodebuild ENOENT'));
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextSteps).toBeUndefined();
      expect(result.nextStepParams).toBeUndefined();
    });
  });

  describe('Finalized Output Contract', () => {
    it('produces correct success output when finalized', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          existsSync: () => true,
          readFile: async () => JSON.stringify({ result: { process: { processIdentifier: 42 } } }),
        }),
      );

      const finalized = finalizePendingXcodebuildResponse(result);

      expect(finalized.isError).toBe(false);
      expect(finalized.content.length).toBeGreaterThan(0);

      const textContent = finalized.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');

      // Front matter
      expect(textContent).toContain('Build & Run');
      expect(textContent).toContain('Scheme: MyApp');

      // Summary
      expect(textContent).toContain('Build succeeded.');

      // No next steps in finalized output (those come from tool invoker)
      expect(textContent).not.toContain('Next steps:');
    });

    it('produces correct failure output when finalized', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed',
      });

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      const finalized = finalizePendingXcodebuildResponse(result);

      expect(finalized.isError).toBe(true);
      const textContent = finalized.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');

      // Front matter present
      expect(textContent).toContain('Build & Run');

      // Summary present
      expect(textContent).toContain('Build failed.');

      // No next steps on failure
      expect(textContent).not.toContain('Next steps:');
    });

    it('produces correct post-build failure output when finalized', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        }

        if (command[0] === '/bin/sh') {
          return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
        }

        if (command.includes('install')) {
          return createMockCommandResponse({ success: false, error: 'Device not connected' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const result = await build_run_deviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      const finalized = finalizePendingXcodebuildResponse(result);

      expect(finalized.isError).toBe(true);
      const textContent = finalized.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');

      // Front matter present
      expect(textContent).toContain('Build & Run');

      // Error and summary present
      expect(textContent).toContain('Failed to install app on device');
      expect(textContent).toContain('Build failed.');

      // No next steps on failure
      expect(textContent).not.toContain('Next steps:');
    });
  });
});
