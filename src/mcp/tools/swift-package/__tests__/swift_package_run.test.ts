/**
 * Tests for swift_package_run plugin
 * Following CLAUDE.md testing standards with literal validation
 * Integration tests using dependency injection for deterministic testing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, swift_package_runLogic } from '../swift_package_run.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

describe('swift_package_run plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      const strictSchema = z.strictObject(schema);

      expect(strictSchema.safeParse({ packagePath: 'valid/path' }).success).toBe(true);
      expect(strictSchema.safeParse({ packagePath: null }).success).toBe(false);

      expect(
        strictSchema.safeParse({
          packagePath: 'valid/path',
          executableName: 'MyExecutable',
          arguments: ['arg1', 'arg2'],
          timeout: 30,
          background: true,
          parseAsLibrary: true,
        }).success,
      ).toBe(true);

      expect(
        strictSchema.safeParse({ packagePath: 'valid/path', executableName: 123 }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: 'valid/path', arguments: ['arg1', 123] }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: 'valid/path', configuration: 'release' }).success,
      ).toBe(false);
      expect(strictSchema.safeParse({ packagePath: 'valid/path', timeout: '30' }).success).toBe(
        false,
      );
      expect(
        strictSchema.safeParse({ packagePath: 'valid/path', background: 'true' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: 'valid/path', parseAsLibrary: 'true' }).success,
      ).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(
        [
          'arguments',
          'background',
          'executableName',
          'packagePath',
          'parseAsLibrary',
          'timeout',
        ].sort(),
      );
    });
  });

  let executorCalls: any[] = [];

  beforeEach(() => {
    executorCalls = [];
  });

  describe('Command Generation Testing', () => {
    it('should build correct command for basic run (foreground mode)', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: ['swift', 'run', '--package-path', '/test/package'],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should build correct command with release configuration', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
          configuration: 'release',
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: ['swift', 'run', '--package-path', '/test/package', '-c', 'release'],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should build correct command with executable name', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
          executableName: 'MyApp',
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: ['swift', 'run', '--package-path', '/test/package', 'MyApp'],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should build correct command with arguments', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
          arguments: ['arg1', 'arg2'],
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: ['swift', 'run', '--package-path', '/test/package', '--', 'arg1', 'arg2'],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should build correct command with parseAsLibrary flag', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
          parseAsLibrary: true,
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: [
          'swift',
          'run',
          '--package-path',
          '/test/package',
          '-Xswiftc',
          '-parse-as-library',
        ],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should build correct command with all parameters', async () => {
      const mockExecutor: CommandExecutor = (command, logPrefix, useShell, opts) => {
        executorCalls.push({ command, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'Process completed',
            error: undefined,
          }),
        );
      };

      await swift_package_runLogic(
        {
          packagePath: '/test/package',
          executableName: 'MyApp',
          configuration: 'release',
          arguments: ['arg1'],
          parseAsLibrary: true,
        },
        mockExecutor,
      );

      expect(executorCalls[0]).toEqual({
        command: [
          'swift',
          'run',
          '--package-path',
          '/test/package',
          '-c',
          'release',
          '-Xswiftc',
          '-parse-as-library',
          'MyApp',
          '--',
          'arg1',
        ],
        logPrefix: 'Swift Package Run',
        useShell: false,
        opts: undefined,
      });
    });

    it('should not call executor for background mode', async () => {
      const mockExecutor = createNoopExecutor();

      const result = await swift_package_runLogic(
        {
          packagePath: '/test/package',
          background: true,
        },
        mockExecutor,
      );

      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Started executable in background');
    });
  });

  describe('Response Logic Testing', () => {
    it('should return validation error for missing packagePath', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Parameter validation failed');
      expect(text).toContain('packagePath');
    });

    it('should return success response for background mode', async () => {
      const mockExecutor = createNoopExecutor();
      const result = await swift_package_runLogic(
        {
          packagePath: '/test/package',
          background: true,
        },
        mockExecutor,
      );

      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Started executable in background');
    });

    it('should return success response for successful execution', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Hello, World!',
      });

      const result = await swift_package_runLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift Package Run');
      expect(text).toContain('Swift executable completed successfully');
      expect(text).toContain('Hello, World!');
    });

    it('should return error response for failed execution', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Compilation failed',
      });

      const result = await swift_package_runLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift executable failed');
      expect(text).toContain('Compilation failed');
    });

    it('should handle executor error', async () => {
      const mockExecutor = createMockExecutor(new Error('Command not found'));

      const result = await swift_package_runLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Failed to execute swift run');
      expect(text).toContain('Command not found');
    });
  });
});
