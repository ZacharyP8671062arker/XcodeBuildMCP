import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, type CommandExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, showBuildSettingsLogic } from '../show_build_settings.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('show_build_settings plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose an empty public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ projectPath: '/path.xcodeproj' }).success).toBe(false);
      expect(schemaObj.safeParse({ scheme: 'App' }).success).toBe(false);
      expect(Object.keys(schema)).toEqual([]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should execute with valid parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
        error: undefined,
        process: { pid: 12345 },
      });

      const result = await showBuildSettingsLogic(
        { projectPath: '/valid/path.xcodeproj', scheme: 'MyScheme' },
        mockExecutor,
      );
      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain('Scheme: MyScheme');
    });

    it('should test Zod validation through handler', async () => {
      const result = await handler({
        projectPath: null,
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should return success with build settings and strip preamble', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Command line invocation:
    /usr/bin/xcodebuild -showBuildSettings -project /path/to/MyProject.xcodeproj -scheme MyScheme

Resolve Package Graph

Build settings for action build and target MyApp:
    ARCHS = arm64
    BUILD_DIR = /Users/dev/Build/Products
    CONFIGURATION = Debug
    DEVELOPMENT_TEAM = ABC123DEF4
    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.MyApp
    PRODUCT_NAME = MyApp
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator`,
        error: undefined,
        process: { pid: 12345 },
      });

      const wrappedExecutor: CommandExecutor = (...args) => {
        calls.push(args);
        return mockExecutor(...args);
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        wrappedExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/MyProject.xcodeproj',
          '-scheme',
          'MyScheme',
        ],
        'Show Build Settings',
        false,
      ]);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain('Scheme: MyScheme');
      expect(text).toContain('Project: /path/to/MyProject.xcodeproj');
      expect(text).toContain('Build settings for action build and target MyApp:');
      expect(text).toContain('PRODUCT_NAME = MyApp');
      expect(result.nextStepParams).toEqual({
        build_macos: { projectPath: '/path/to/MyProject.xcodeproj', scheme: 'MyScheme' },
        build_sim: {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        list_schemes: { projectPath: '/path/to/MyProject.xcodeproj' },
      });
    });

    it('should return error when command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error:
          'xcodebuild: error: The workspace named "App" does not contain a scheme named "InvalidScheme".',
        process: { pid: 12345 },
      });

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'InvalidScheme',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain(
        'The workspace named "App" does not contain a scheme named "InvalidScheme".',
      );
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = async () => {
        throw new Error('Command execution failed');
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain('Command execution failed');
      expect(result.nextStepParams).toBeUndefined();
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should error when both projectPath and workspacePath provided', async () => {
      const result = await handler({
        projectPath: '/path/project.xcodeproj',
        workspacePath: '/path/workspace.xcworkspace',
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });

    it('should work with projectPath only', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
      });

      const result = await showBuildSettingsLogic(
        { projectPath: '/valid/path.xcodeproj', scheme: 'MyScheme' },
        mockExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain('Scheme: MyScheme');
    });

    it('should work with workspacePath only', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
      });

      const result = await showBuildSettingsLogic(
        { workspacePath: '/valid/path.xcworkspace', scheme: 'MyScheme' },
        mockExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Show Build Settings');
      expect(text).toContain('Workspace:');
    });
  });

  describe('Session requirement handling', () => {
    it('should require scheme when not provided', async () => {
      const result = await handler({
        projectPath: '/path/to/MyProject.xcodeproj',
      } as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should surface project/workspace requirement even with scheme default', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });
  });
});
