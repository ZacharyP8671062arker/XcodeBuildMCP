import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, swift_package_testLogic } from '../swift_package_test.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

describe('swift_package_test plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      const strictSchema = z.strictObject(schema);

      expect(strictSchema.safeParse({ packagePath: '/test/package' }).success).toBe(true);
      expect(strictSchema.safeParse({ packagePath: '' }).success).toBe(true);

      expect(
        strictSchema.safeParse({
          packagePath: '/test/package',
          testProduct: 'MyTests',
          filter: 'Test.*',
          parallel: true,
          showCodecov: true,
          parseAsLibrary: true,
        }).success,
      ).toBe(true);

      expect(strictSchema.safeParse({ packagePath: null }).success).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', configuration: 'release' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', parallel: 'yes' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', showCodecov: 'yes' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', parseAsLibrary: 'yes' }).success,
      ).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(
        [
          'filter',
          'packagePath',
          'parseAsLibrary',
          'parallel',
          'showCodecov',
          'testProduct',
        ].sort(),
      );
    });
  });

  describe('Command Generation Testing', () => {
    it('should build correct command for basic test', async () => {
      const calls: Array<{
        args: string[];
        name?: string;
        hideOutput?: boolean;
        opts?: { env?: Record<string, string>; cwd?: string };
      }> = [];
      const mockExecutor: CommandExecutor = async (args, name, hideOutput, opts) => {
        calls.push({ args, name, hideOutput, opts });
        return createMockCommandResponse({
          success: true,
          output: 'Test Passed',
          error: undefined,
        });
      };

      await swift_package_testLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: ['swift', 'test', '--package-path', '/test/package'],
        name: 'Swift Package Test',
        hideOutput: false,
        opts: undefined,
      });
    });

    it('should build correct command with all parameters', async () => {
      const calls: Array<{
        args: string[];
        name?: string;
        hideOutput?: boolean;
        opts?: { env?: Record<string, string>; cwd?: string };
      }> = [];
      const mockExecutor: CommandExecutor = async (args, name, hideOutput, opts) => {
        calls.push({ args, name, hideOutput, opts });
        return createMockCommandResponse({
          success: true,
          output: 'Tests completed',
          error: undefined,
        });
      };

      await swift_package_testLogic(
        {
          packagePath: '/test/package',
          testProduct: 'MyTests',
          filter: 'Test.*',
          configuration: 'release',
          parallel: false,
          showCodecov: true,
          parseAsLibrary: true,
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: [
          'swift',
          'test',
          '--package-path',
          '/test/package',
          '-c',
          'release',
          '--test-product',
          'MyTests',
          '--filter',
          'Test.*',
          '--no-parallel',
          '--show-code-coverage',
          '-Xswiftc',
          '-parse-as-library',
        ],
        name: 'Swift Package Test',
        hideOutput: false,
        opts: undefined,
      });
    });
  });

  describe('Response Logic Testing', () => {
    it('should handle empty packagePath parameter', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tests completed with empty path',
      });

      const result = await swift_package_testLogic({ packagePath: '' }, mockExecutor);

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift package tests completed');
    });

    it('should return successful test response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'All tests passed.',
      });

      const result = await swift_package_testLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift Package Test');
      expect(text).toContain('Swift package tests completed');
      expect(text).toContain('All tests passed.');
    });

    it('should return error response for test failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: '2 tests failed',
      });

      const result = await swift_package_testLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift package tests failed');
      expect(text).toContain('2 tests failed');
    });

    it('should include stdout diagnostics when stderr is empty on test failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        output:
          "main.swift:10:25: error: cannot find type 'DOESNOTEXIST' in scope\nlet broken: DOESNOTEXIST = 42",
      });

      const result = await swift_package_testLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift package tests failed');
      expect(text).toContain("cannot find type 'DOESNOTEXIST' in scope");
    });

    it('should handle spawn error', async () => {
      const mockExecutor = async () => {
        throw new Error('spawn ENOENT');
      };

      const result = await swift_package_testLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Failed to execute swift test');
      expect(text).toContain('spawn ENOENT');
    });

    it('should handle successful test with parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tests completed.',
      });

      const result = await swift_package_testLogic(
        {
          packagePath: '/test/package',
          testProduct: 'MyTests',
          filter: 'Test.*',
          configuration: 'release',
          parallel: false,
          showCodecov: true,
          parseAsLibrary: true,
        },
        mockExecutor,
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift Package Test');
      expect(text).toContain('Swift package tests completed');
      expect(text).toContain('Tests completed.');
    });
  });
});
