import { describe, it, expect, beforeEach } from 'vitest';
import { schema, handler, swift_package_listLogic } from '../swift_package_list.ts';

describe('swift_package_list plugin', () => {
  // No mocks to clear with pure dependency injection

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      // The schema is an empty object, so any input should be valid
      expect(typeof schema).toBe('object');
      expect(Object.keys(schema)).toEqual([]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return empty list when no processes are running', async () => {
      const mockProcessMap = new Map();
      const mockArrayFrom = () => [];
      const mockDateNow = () => Date.now();

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Swift Package Processes');
      expect(text).toContain('No Swift Package processes currently running');
    });

    it('should handle empty args object', async () => {
      const mockProcessMap = new Map();
      const mockArrayFrom = () => [];
      const mockDateNow = () => Date.now();

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('No Swift Package processes currently running');
    });

    it('should handle null args', async () => {
      const mockProcessMap = new Map();
      const mockArrayFrom = () => [];
      const mockDateNow = () => Date.now();

      const result = await swift_package_listLogic(null, {
        processMap: mockProcessMap,
        arrayFrom: mockArrayFrom,
        dateNow: mockDateNow,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('No Swift Package processes currently running');
    });

    it('should handle undefined args', async () => {
      const mockProcessMap = new Map();
      const mockArrayFrom = () => [];
      const mockDateNow = () => Date.now();

      const result = await swift_package_listLogic(undefined, {
        processMap: mockProcessMap,
        arrayFrom: mockArrayFrom,
        dateNow: mockDateNow,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('No Swift Package processes currently running');
    });

    it('should handle args with extra properties', async () => {
      const mockProcessMap = new Map();
      const mockArrayFrom = () => [];
      const mockDateNow = () => Date.now();

      const result = await swift_package_listLogic(
        {
          extraProperty: 'value',
          anotherProperty: 123,
        },
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('No Swift Package processes currently running');
    });

    it('should return single process when one process is running', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: 'MyApp',
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map([[12345, mockProcess]]);
      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime() + 5000;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Running Processes (1)');
      expect(text).toContain('12345');
      expect(text).toContain('MyApp');
      expect(text).toContain('/test/package');
      expect(text).toContain('5s');
    });

    it('should return multiple processes when several are running', async () => {
      const startedAt1 = new Date('2023-01-01T10:00:00.000Z');
      const startedAt2 = new Date('2023-01-01T10:00:07.000Z');

      const mockProcess1 = {
        executableName: 'MyApp',
        packagePath: '/test/package1',
        startedAt: startedAt1,
      };

      const mockProcess2 = {
        executableName: undefined,
        packagePath: '/test/package2',
        startedAt: startedAt2,
      };

      const mockProcessMap = new Map<
        number,
        { executableName?: string; packagePath: string; startedAt: Date }
      >([
        [12345, mockProcess1],
        [12346, mockProcess2],
      ]);

      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt1.getTime() + 10000;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('Running Processes (2)');
      expect(text).toContain('12345');
      expect(text).toContain('MyApp');
      expect(text).toContain('/test/package1');
      expect(text).toContain('10s');
      expect(text).toContain('12346');
      expect(text).toContain('default');
      expect(text).toContain('/test/package2');
      expect(text).toContain('3s');
    });

    it('should handle process with missing executableName', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: undefined,
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map<
        number,
        { executableName?: string; packagePath: string; startedAt: Date }
      >([[12345, mockProcess]]);

      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime() + 1000;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('default');
      expect(text).toContain('1s');
    });

    it('should handle process with empty string executableName', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: '',
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map([[12345, mockProcess]]);
      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime() + 2000;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('default');
      expect(text).toContain('2s');
    });

    it('should handle very recent process (less than 1 second)', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: 'FastApp',
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map([[12345, mockProcess]]);
      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime() + 500;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('FastApp');
      expect(text).toContain('1s');
    });

    it('should handle process running for exactly 0 milliseconds', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: 'InstantApp',
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map([[12345, mockProcess]]);
      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime();

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('InstantApp');
      expect(text).toContain('1s');
    });

    it('should handle process running for a long time', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const mockProcess = {
        executableName: 'LongRunningApp',
        packagePath: '/test/package',
        startedAt: startedAt,
      };

      const mockProcessMap = new Map([[12345, mockProcess]]);
      const mockArrayFrom = (mapEntries: any) => Array.from(mapEntries);
      const mockDateNow = () => startedAt.getTime() + 7200000;

      const result = await swift_package_listLogic(
        {},
        {
          processMap: mockProcessMap,
          arrayFrom: mockArrayFrom,
          dateNow: mockDateNow,
        },
      );

      expect(result.isError).toBeUndefined();
      const text = result.content.map((c) => c.text).join('\n');
      expect(text).toContain('LongRunningApp');
      expect(text).toContain('7200s');
    });
  });
});
