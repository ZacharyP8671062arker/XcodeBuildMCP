/**
 * Tests for get_mac_app_path plugin (unified project/workspace)
 * Following CLAUDE.md testing standards with literal validation
 * Using dependency injection for deterministic testing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  type CommandExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler } from '../get_mac_app_path.ts';
import { get_mac_app_pathLogic } from '../get_mac_app_path.ts';

describe('get_mac_app_path plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      const zodSchema = z.object(schema);

      expect(zodSchema.safeParse({}).success).toBe(true);
      expect(
        zodSchema.safeParse({
          derivedDataPath: '/path/to/derived',
          extraArgs: ['--verbose'],
        }).success,
      ).toBe(true);

      expect(zodSchema.safeParse({ derivedDataPath: 7 }).success).toBe(false);
      expect(zodSchema.safeParse({ extraArgs: ['--bad', 1] }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['derivedDataPath', 'extraArgs'].sort());
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme before running', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should reject when both projectPath and workspacePath provided explicitly', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should error when both projectPath and workspacePath provided', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct command with workspace minimal parameters', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        workspacePath: '/path/to/MyProject.xcworkspace',
        scheme: 'MyScheme',
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-workspace',
          '/path/to/MyProject.xcworkspace',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
        ],
        'Get App Path',
        false,
      ]);
    });

    it('should generate correct command with project minimal parameters', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        projectPath: '/path/to/MyProject.xcodeproj',
        scheme: 'MyScheme',
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/MyProject.xcodeproj',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
        ],
        'Get App Path',
        false,
      ]);
    });

    it('should generate correct command with workspace all parameters', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        workspacePath: '/path/to/MyProject.xcworkspace',
        scheme: 'MyScheme',
        configuration: 'Release',
        arch: 'arm64' as const,
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-workspace',
          '/path/to/MyProject.xcworkspace',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Release',
          '-destination',
          'platform=macOS,arch=arm64',
        ],
        'Get App Path',
        false,
      ]);
    });

    it('should generate correct command with x86_64 architecture', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        workspacePath: '/path/to/MyProject.xcworkspace',
        scheme: 'MyScheme',
        configuration: 'Debug',
        arch: 'x86_64' as const,
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-workspace',
          '/path/to/MyProject.xcworkspace',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
          '-destination',
          'platform=macOS,arch=x86_64',
        ],
        'Get App Path',
        false,
      ]);
    });

    it('should generate correct command with project all parameters', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        projectPath: '/path/to/MyProject.xcodeproj',
        scheme: 'MyScheme',
        configuration: 'Release',
        derivedDataPath: '/path/to/derived',
        extraArgs: ['--verbose'],
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/MyProject.xcodeproj',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Release',
          '-derivedDataPath',
          '/path/to/derived',
          '--verbose',
        ],
        'Get App Path',
        false,
      ]);
    });

    it('should use default configuration when not provided', async () => {
      // Manual call tracking for command verification
      const calls: any[] = [];
      const mockExecutor: CommandExecutor = async (...args) => {
        calls.push(args);
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
          error: undefined,
        });
      };

      const args = {
        workspacePath: '/path/to/MyProject.xcworkspace',
        scheme: 'MyScheme',
        arch: 'arm64' as const,
      };

      await get_mac_app_pathLogic(args, mockExecutor);

      // Verify command generation with manual call tracking
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-workspace',
          '/path/to/MyProject.xcworkspace',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
          '-destination',
          'platform=macOS,arch=arm64',
        ],
        'Get App Path',
        false,
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    function textOf(result: { content: Array<{ type: string; text: string }> }): string {
      return result.content
        .filter((i) => i.type === 'text')
        .map((i) => i.text)
        .join('\n');
    }

    it('should return Zod validation error for missing scheme', async () => {
      const result = await handler({
        workspacePath: '/path/to/MyProject.xcworkspace',
      });

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('scheme is required');
      expect(text).toContain('session-set-defaults');
    });

    it('should return exact successful app path response with workspace', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `
BUILT_PRODUCTS_DIR = /Users/test/Library/Developer/Xcode/DerivedData/MyApp-abc123/Build/Products/Debug
FULL_PRODUCT_NAME = MyApp.app
        `,
      });

      const result = await get_mac_app_pathLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      const appPath =
        '/Users/test/Library/Developer/Xcode/DerivedData/MyApp-abc123/Build/Products/Debug/MyApp.app';

      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('Scheme: MyScheme');
      expect(text).toContain('Workspace: /path/to/MyProject.xcworkspace');
      expect(text).toContain('Configuration: Debug');
      expect(text).toContain('Platform: macOS');
      expect(text).toContain(`App Path: ${appPath}`);
      expect(result.nextStepParams).toEqual({
        get_mac_bundle_id: { appPath },
        launch_mac_app: { appPath },
      });
    });

    it('should return exact successful app path response with project', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `
BUILT_PRODUCTS_DIR = /Users/test/Library/Developer/Xcode/DerivedData/MyApp-abc123/Build/Products/Debug
FULL_PRODUCT_NAME = MyApp.app
        `,
      });

      const result = await get_mac_app_pathLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      const appPath =
        '/Users/test/Library/Developer/Xcode/DerivedData/MyApp-abc123/Build/Products/Debug/MyApp.app';

      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('Scheme: MyScheme');
      expect(text).toContain('Project: /path/to/MyProject.xcodeproj');
      expect(text).toContain('Configuration: Debug');
      expect(text).toContain('Platform: macOS');
      expect(text).toContain(`App Path: ${appPath}`);
      expect(result.nextStepParams).toEqual({
        get_mac_bundle_id: { appPath },
        launch_mac_app: { appPath },
      });
    });

    it('should return exact build settings failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: No such scheme',
      });

      const result = await get_mac_app_pathLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('Scheme: MyScheme');
      expect(text).toContain('No such scheme');
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should return exact missing build settings response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'OTHER_SETTING = value',
      });

      const result = await get_mac_app_pathLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('Could not extract app path from build settings');
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should return exact exception handling response', async () => {
      const mockExecutor = async () => {
        throw new Error('Network error');
      };

      const result = await get_mac_app_pathLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('Network error');
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
