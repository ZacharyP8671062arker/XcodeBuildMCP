import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, testDeviceLogic } from '../test_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { isPendingXcodebuildResponse } from '../../../../utils/xcodebuild-output.ts';

const mockFs = () =>
  createMockFileSystemExecutor({
    mkdtemp: async () => '/tmp/test-123',
    rm: async () => {},
    tmpdir: () => '/tmp',
    stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
  });

describe('test_device plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only session-free fields in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(
        schemaObj.safeParse({
          extraArgs: ['--arg1'],
          testRunnerEnv: { FOO: 'bar' },
        }).success,
      ).toBe(true);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ derivedDataPath: '/path/to/derived-data' }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(schemaObj.safeParse({ platform: 'iOS' }).success).toBe(false);
      expect(schemaObj.safeParse({ projectPath: '/path/to/project.xcodeproj' }).success).toBe(
        false,
      );

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'progress', 'testRunnerEnv']);
    });

    it('should validate XOR between projectPath and workspacePath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Succeeded',
      });

      const projectResult = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
        },
        mockExecutor,
        mockFs(),
      );
      expect(isPendingXcodebuildResponse(projectResult)).toBe(true);
      expect(projectResult.isError).toBeFalsy();

      const workspaceResult = await testDeviceLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
        },
        mockExecutor,
        mockFs(),
      );
      expect(isPendingXcodebuildResponse(workspaceResult)).toBe(true);
      expect(workspaceResult.isError).toBeFalsy();
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme and device defaults', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide scheme and deviceId');
    });

    it('should require project or workspace when defaults provide scheme and device', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme', deviceId: 'test-device-123' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should reject mutually exclusive project inputs when defaults satisfy requirements', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme', deviceId: 'test-device-123' });

      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return pending response for successful tests', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Succeeded',
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBeFalsy();
    });

    it('should return pending response for test failures', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'error: Test failed',
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBe(true);
    });

    it('should handle build failure with pending response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'error: missing argument for parameter in call',
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBe(true);
    });

    it('should support different platforms', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Succeeded',
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'WatchApp',
          deviceId: 'watch-device-456',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'watchOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBeFalsy();
    });

    it('should handle optional parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Succeeded',
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Release',
          derivedDataPath: '/tmp/derived-data',
          extraArgs: ['--verbose'],
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBeFalsy();
    });

    it('should handle workspace testing successfully', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Succeeded',
      });

      const result = await testDeviceLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'WorkspaceScheme',
          deviceId: 'test-device-456',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        mockFs(),
      );

      expect(isPendingXcodebuildResponse(result)).toBe(true);
      expect(result.isError).toBeFalsy();
    });
  });
});
