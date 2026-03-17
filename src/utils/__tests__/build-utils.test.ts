/**
 * Tests for build-utils Sentry classification logic
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { executeXcodeBuildCommand } from '../build-utils.ts';
import { XcodePlatform } from '../xcode.ts';

describe('build-utils Sentry Classification', () => {
  const mockPlatformOptions = {
    platform: XcodePlatform.macOS,
    logPrefix: 'Test Build',
  };

  const mockParams = {
    scheme: 'TestScheme',
    configuration: 'Debug',
    projectPath: '/path/to/project.xcodeproj',
  };

  describe('Exit Code 64 Classification (MCP Error)', () => {
    it('should trigger Sentry logging for exit code 64 (invalid arguments)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: invalid option',
        exitCode: 64,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] xcodebuild: error: invalid option');
      expect(result.content[1].text).toContain('❌ Test Build build failed for scheme TestScheme');
    });
  });

  describe('Other Exit Codes Classification (User Error)', () => {
    it('should not trigger Sentry logging for exit code 65 (user error)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Scheme TestScheme was not found',
        exitCode: 65,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] Scheme TestScheme was not found');
      expect(result.content[1].text).toContain('❌ Test Build build failed for scheme TestScheme');
    });

    it('should not trigger Sentry logging for exit code 66 (file not found)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'project.xcodeproj cannot be opened',
        exitCode: 66,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] project.xcodeproj cannot be opened');
    });

    it('should not trigger Sentry logging for exit code 70 (destination error)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Unable to find a destination matching the provided destination specifier',
        exitCode: 70,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] Unable to find a destination matching');
    });

    it('should not trigger Sentry logging for exit code 1 (general build failure)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed with errors',
        exitCode: 1,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] Build failed with errors');
    });
  });

  describe('Spawn Error Classification (Environment Error)', () => {
    it('should not trigger Sentry logging for ENOENT spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild ENOENT') as NodeJS.ErrnoException;
      spawnError.code = 'ENOENT';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild ENOENT',
      );
    });

    it('should not trigger Sentry logging for EACCES spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild EACCES') as NodeJS.ErrnoException;
      spawnError.code = 'EACCES';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild EACCES',
      );
    });

    it('should not trigger Sentry logging for EPERM spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild EPERM') as NodeJS.ErrnoException;
      spawnError.code = 'EPERM';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild EPERM',
      );
    });

    it('should trigger Sentry logging for non-spawn exceptions', async () => {
      const otherError = new Error('Unexpected internal error');

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: otherError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: Unexpected internal error',
      );
    });
  });

  describe('Success Case (No Sentry Logging)', () => {
    it('should not trigger any error logging for successful builds', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain(
        '✅ Test Build build succeeded for scheme TestScheme',
      );
    });
  });

  describe('Exit Code Undefined Cases', () => {
    it('should not trigger Sentry logging when exitCode is undefined', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Some error without exit code',
        exitCode: undefined,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('❌ [stderr] Some error without exit code');
    });
  });

  describe('Test Progress Output', () => {
    it('should include per-test progress lines when showTestProgress is enabled', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output:
          "Test Case '-[Suite testA]' passed (0.001 seconds)\n" +
          "Test Suite 'Suite' failed at 2026-01-01 00:00:00.000\n" +
          'Executed 2 tests, with 1 failures (0 unexpected) in 0.123 (0.124) seconds',
        exitCode: 0,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        {
          ...mockPlatformOptions,
          showTestProgress: true,
        },
        false,
        'test',
        mockExecutor,
      );

      const text = result.content.map((item) => item.text).join('\n');
      expect(text).toContain("🧪 Test Case '-[Suite testA]' passed (0.001 seconds)");
      expect(text).toContain("🧪 Test Suite 'Suite' failed at 2026-01-01 00:00:00.000");
      expect(text).toContain(
        '🧪 Executed 2 tests, with 1 failures (0 unexpected) in 0.123 (0.124) seconds',
      );
    });

    it('should omit per-test progress lines when showTestProgress is disabled', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: "Test Case '-[Suite testA]' passed (0.001 seconds)",
        exitCode: 0,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        {
          ...mockPlatformOptions,
          showTestProgress: false,
        },
        false,
        'test',
        mockExecutor,
      );

      const text = result.content.map((item) => item.text).join('\n');
      expect(text).not.toContain('🧪 Test Case');
    });

    it('should stream test progress immediately in CLI text output mode', async () => {
      const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;
      const originalOutputFormat = process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
      process.env.XCODEBUILDMCP_RUNTIME = 'cli';
      process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'text';

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const mockExecutor = createMockExecutor({
        success: true,
        output: "Test Case '-[Suite streamed]' passed (0.010 seconds)",
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          opts?.onStdout?.("Test Case '-[Suite streamed]' passed (0.010 seconds)\\n");
        },
      });

      try {
        const result = await executeXcodeBuildCommand(
          mockParams,
          {
            ...mockPlatformOptions,
            showTestProgress: true,
          },
          false,
          'test',
          mockExecutor,
        );

        const streamedOutput = stdoutWrite.mock.calls.flat().join('');
        expect(streamedOutput).toContain('🧪 Test configuration: scheme=TestScheme');
        expect(streamedOutput).toContain("🧪 Test Case '-[Suite streamed]' passed (0.010 seconds)");

        const responseText = result.content.map((item) => item.text).join('\n');
        expect(responseText).not.toContain('🧪 Test Case');
      } finally {
        stdoutWrite.mockRestore();
        if (originalRuntime === undefined) {
          delete process.env.XCODEBUILDMCP_RUNTIME;
        } else {
          process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
        }
        if (originalOutputFormat === undefined) {
          delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
        } else {
          process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = originalOutputFormat;
        }
      }
    });

    it('should not stream progress in CLI JSON output mode', async () => {
      const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;
      const originalOutputFormat = process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
      process.env.XCODEBUILDMCP_RUNTIME = 'cli';
      process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'json';

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const mockExecutor = createMockExecutor({
        success: true,
        output: "Test Case '-[Suite json]' passed (0.020 seconds)",
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          opts?.onStdout?.("Test Case '-[Suite json]' passed (0.020 seconds)\\n");
        },
      });

      try {
        const result = await executeXcodeBuildCommand(
          mockParams,
          {
            ...mockPlatformOptions,
            showTestProgress: true,
          },
          false,
          'test',
          mockExecutor,
        );

        const streamedOutput = stdoutWrite.mock.calls.flat().join('');
        expect(streamedOutput).not.toContain("🧪 Test Case '-[Suite json]' passed (0.020 seconds)");

        const responseText = result.content.map((item) => item.text).join('\n');
        expect(responseText).toContain("🧪 Test Case '-[Suite json]' passed (0.020 seconds)");
      } finally {
        stdoutWrite.mockRestore();
        if (originalRuntime === undefined) {
          delete process.env.XCODEBUILDMCP_RUNTIME;
        } else {
          process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
        }
        if (originalOutputFormat === undefined) {
          delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
        } else {
          process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = originalOutputFormat;
        }
      }
    });
  });

  describe('Working Directory (cwd) Handling', () => {
    it('should pass project directory as cwd for workspace builds', async () => {
      let capturedOptions: any;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          workspacePath: '/path/to/project/MyProject.xcworkspace',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.cwd).toBe('/path/to/project');
    });

    it('should pass project directory as cwd for project builds', async () => {
      let capturedOptions: any;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: '/path/to/project/MyProject.xcodeproj',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.cwd).toBe('/path/to/project');
    });

    it('should merge cwd with existing execOpts', async () => {
      let capturedOptions: any;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          workspacePath: '/path/to/project/MyProject.xcworkspace',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        { env: { CUSTOM_VAR: 'value' } },
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.cwd).toBe('/path/to/project');
      expect(capturedOptions.env).toEqual({ CUSTOM_VAR: 'value' });
    });

    it('should resolve relative project and derived data paths before execution', async () => {
      let capturedOptions: unknown;
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (command, _logPrefix, _useShell, opts) => {
          capturedCommand = command;
          capturedOptions = opts;
        },
      });

      const relativeProjectPath = 'example_projects/iOS/MCPTest.xcodeproj';
      const relativeDerivedDataPath = '.derivedData/e2e';
      const expectedProjectPath = path.resolve(relativeProjectPath);
      const expectedDerivedDataPath = path.resolve(relativeDerivedDataPath);

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: relativeProjectPath,
          derivedDataPath: relativeDerivedDataPath,
        },
        {
          platform: XcodePlatform.iOSSimulator,
          simulatorName: 'iPhone 17 Pro',
          useLatestOS: true,
          logPrefix: 'iOS Simulator Build',
        },
        false,
        'build',
        mockExecutor,
      );

      expect(capturedCommand).toBeDefined();
      expect(capturedCommand).toContain(expectedProjectPath);
      expect(capturedCommand).toContain(expectedDerivedDataPath);
      expect(capturedOptions).toEqual(
        expect.objectContaining({ cwd: path.dirname(expectedProjectPath) }),
      );
    });
  });
});
