import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, launch_mac_appLogic } from '../launch_mac_app.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('launch_mac_app plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema with valid inputs', () => {
      const zodSchema = z.object(schema);
      expect(
        zodSchema.safeParse({
          appPath: '/path/to/MyApp.app',
        }).success,
      ).toBe(true);
      expect(
        zodSchema.safeParse({
          appPath: '/Applications/Calculator.app',
          args: ['--debug'],
        }).success,
      ).toBe(true);
      expect(
        zodSchema.safeParse({
          appPath: '/path/to/MyApp.app',
          args: ['--debug', '--verbose'],
        }).success,
      ).toBe(true);
    });

    it('should validate schema with invalid inputs', () => {
      const zodSchema = z.object(schema);
      expect(zodSchema.safeParse({}).success).toBe(false);
      expect(zodSchema.safeParse({ appPath: null }).success).toBe(false);
      expect(zodSchema.safeParse({ appPath: 123 }).success).toBe(false);
      expect(
        zodSchema.safeParse({ appPath: '/path/to/MyApp.app', args: 'not-array' }).success,
      ).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should handle non-existent app path', async () => {
      const mockExecutor = async () => Promise.resolve(createMockCommandResponse());
      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => false,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/NonExistent.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = result.content
        .filter((i) => i.type === 'text')
        .map((i) => i.text)
        .join('\n');
      expect(text).toContain("File not found: '/path/to/NonExistent.app'");
    });
  });

  describe('Command Generation', () => {
    it('should generate correct command with minimal parameters', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return createMockCommandResponse();
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual(['open', '/path/to/MyApp.app']);
    });

    it('should generate correct command with args parameter', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return createMockCommandResponse();
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
          args: ['--debug', '--verbose'],
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual([
        'open',
        '/path/to/MyApp.app',
        '--args',
        '--debug',
        '--verbose',
      ]);
    });

    it('should generate correct command with empty args array', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return createMockCommandResponse();
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
          args: [],
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual(['open', '/path/to/MyApp.app']);
    });

    it('should handle paths with spaces correctly', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return createMockCommandResponse();
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await launch_mac_appLogic(
        {
          appPath: '/Applications/My App.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual(['open', '/Applications/My App.app']);
    });
  });

  describe('Response Processing', () => {
    it('should return successful launch response', async () => {
      const mockExecutor = async () => Promise.resolve(createMockCommandResponse());

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Launch macOS App');
      expect(text).toContain('/path/to/MyApp.app');
      expect(text).toContain('App launched successfully');
    });

    it('should return successful launch response with args', async () => {
      const mockExecutor = async () => Promise.resolve(createMockCommandResponse());

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
          args: ['--debug', '--verbose'],
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('App launched successfully');
    });

    it('should handle launch failure with Error object', async () => {
      const mockExecutor = async () => {
        throw new Error('App not found');
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Launch macOS app operation failed: App not found');
    });

    it('should handle launch failure with string error', async () => {
      const mockExecutor = async () => {
        throw 'Permission denied';
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Launch macOS app operation failed: Permission denied');
    });

    it('should handle launch failure with unknown error type', async () => {
      const mockExecutor = async () => {
        throw 123;
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await launch_mac_appLogic(
        {
          appPath: '/path/to/MyApp.app',
        },
        mockExecutor,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Launch macOS app operation failed: 123');
    });
  });
});
