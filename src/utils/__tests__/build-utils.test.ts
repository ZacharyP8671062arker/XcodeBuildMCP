/**
 * Tests for build-utils Sentry classification logic
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { executeXcodeBuildCommand } from '../build-utils.ts';
import { XcodePlatform } from '../xcode.ts';

describe('build-utils Sentry Classification', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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
      expect(result.content[1].text).toContain('Test Build build failed for scheme TestScheme');
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
      expect(result.content[1].text).toContain('Test Build build failed for scheme TestScheme');
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
      const stderrItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('[stderr]'),
      );
      expect(stderrItem?.text).toContain('❌ [stderr] project.xcodeproj cannot be opened');
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
      const stderrItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('[stderr]'),
      );
      expect(stderrItem?.text).toContain('❌ [stderr] Unable to find a destination matching');
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
      const stderrItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('[stderr]'),
      );
      expect(stderrItem?.text).toContain('❌ [stderr] Build failed with errors');
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
      const errorItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('Error during'),
      );
      expect(errorItem?.text).toContain('Error during Test Build build: spawn xcodebuild ENOENT');
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
      const errorItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('Error during'),
      );
      expect(errorItem?.text).toContain('Error during Test Build build: spawn xcodebuild EACCES');
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
      const errorItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('Error during'),
      );
      expect(errorItem?.text).toContain('Error during Test Build build: spawn xcodebuild EPERM');
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
      const errorItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('Error during'),
      );
      expect(errorItem?.text).toContain('Error during Test Build build: Unexpected internal error');
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
      const stderrItem = result.content.find(
        (c) => c.type === 'text' && c.text.includes('[stderr]'),
      );
      expect(stderrItem?.text).toContain('❌ [stderr] Some error without exit code');
    });
  });

  describe('Simulator Test Flags', () => {
    it('should add simulator-specific flags when running simulator tests', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'TEST SUCCEEDED',
        exitCode: 0,
        onExecute: (command) => {
          capturedCommand = command;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: '/path/to/project.xcodeproj',
          extraArgs: ['-only-testing:AppTests'],
        },
        {
          platform: XcodePlatform.iOSSimulator,
          simulatorId: 'SIM-UUID',
          simulatorName: 'iPhone 17 Pro',
          logPrefix: 'Simulator Test',
        },
        false,
        'test',
        mockExecutor,
      );

      expect(capturedCommand).toBeDefined();
      expect(capturedCommand).toContain('-destination');
      expect(capturedCommand).toContain('platform=iOS Simulator,id=SIM-UUID');
      expect(capturedCommand).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
      expect(capturedCommand).toContain('ONLY_ACTIVE_ARCH=YES');
      expect(capturedCommand).toContain('-packageCachePath');
      expect(capturedCommand).toContain(
        path.join(process.env.HOME ?? '', 'Library', 'Caches', 'org.swift.swiftpm'),
      );
      expect(capturedCommand).toContain('-only-testing:AppTests');
      expect(capturedCommand?.at(-1)).toBe('test');
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
