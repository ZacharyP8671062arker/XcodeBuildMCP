import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { schema, handler, discover_projsLogic, discoverProjects } from '../discover_projs.ts';
import { createMockFileSystemExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('discover_projs plugin', () => {
  let mockFileSystemExecutor: any;

  // Create mock file system executor
  mockFileSystemExecutor = createMockFileSystemExecutor({
    stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    readdir: async () => [],
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema with valid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ workspaceRoot: '/path/to/workspace' }).success).toBe(true);
      expect(
        schemaObj.safeParse({ workspaceRoot: '/path/to/workspace', scanPath: 'subdir' }).success,
      ).toBe(true);
      expect(
        schemaObj.safeParse({ workspaceRoot: '/path/to/workspace', maxDepth: 3 }).success,
      ).toBe(true);
      expect(
        schemaObj.safeParse({
          workspaceRoot: '/path/to/workspace',
          scanPath: 'subdir',
          maxDepth: 5,
        }).success,
      ).toBe(true);
    });

    it('should validate schema with invalid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', scanPath: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: 'invalid' }).success).toBe(
        false,
      );
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: -1 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: 1.5 }).success).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('returns structured discovery results for setup flows', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'App.xcodeproj', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'App.xcworkspace', isDirectory: () => true, isSymbolicLink: () => false },
      ];

      const result = await discoverProjects(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );
      expect(result.projects).toEqual(['/workspace/App.xcodeproj']);
      expect(result.workspaces).toEqual(['/workspace/App.xcworkspace']);
    });

    it('should handle workspaceRoot parameter correctly when provided', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Discover Projects');
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should return error when scan path does not exist', async () => {
      mockFileSystemExecutor.stat = async () => {
        throw new Error('ENOENT: no such file or directory');
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Discover Projects');
      expect(text).toContain(
        'Failed to access scan path: /workspace. Error: ENOENT: no such file or directory',
      );
    });

    it('should return error when scan path is not a directory', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => false, mtimeMs: 0 });

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Scan path is not a directory: /workspace');
    });

    it('should return success with no projects found', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should return success with projects found', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'MyApp.xcodeproj', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'MyWorkspace.xcworkspace', isDirectory: () => true, isSymbolicLink: () => false },
      ];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 1 project(s) and 1 workspace(s).');
      expect(text).toContain('/workspace/MyApp.xcodeproj');
      expect(text).toContain('/workspace/MyWorkspace.xcworkspace');
      expect(text).toContain('session-set-defaults');
    });

    it('should handle fs error with code', async () => {
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      mockFileSystemExecutor.stat = async () => {
        throw error;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to access scan path: /workspace. Error: Permission denied');
    });

    it('should handle string error', async () => {
      mockFileSystemExecutor.stat = async () => {
        throw 'String error';
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to access scan path: /workspace. Error: String error');
    });

    it('should handle workspaceRoot parameter correctly', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should handle scan path outside workspace root', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '../outside',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should handle error with object containing message and code properties', async () => {
      const errorObject = {
        message: 'Access denied',
        code: 'EACCES',
      };
      mockFileSystemExecutor.stat = async () => {
        throw errorObject;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to access scan path: /workspace. Error: Access denied');
    });

    it('should handle max depth reached during recursive scan', async () => {
      let readdirCallCount = 0;

      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => {
        readdirCallCount++;
        if (readdirCallCount <= 3) {
          return [
            {
              name: `subdir${readdirCallCount}`,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          ];
        }
        return [];
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 3,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should handle skipped directory types during scan', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'build', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'DerivedData', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'symlink', isDirectory: () => true, isSymbolicLink: () => true },
        { name: 'regular.txt', isDirectory: () => false, isSymbolicLink: () => false },
      ];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });

    it('should handle error during recursive directory reading', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => {
        const readError = new Error('Permission denied');
        (readError as any).code = 'EACCES';
        throw readError;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Found 0 project(s) and 0 workspace(s).');
    });
  });
});
