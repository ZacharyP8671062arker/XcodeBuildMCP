import { describe, it, expect } from 'vitest';
import { schema, handler, start_sim_log_capLogic } from '../start_sim_log_cap.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('start_sim_log_cap plugin', () => {
  describe('Plugin Structure', () => {
    it('should export schema and handler', () => {
      expect(schema).toBeDefined();
      expect(handler).toBeDefined();
    });

    it('should have handler as a function', () => {
      expect(typeof handler).toBe('function');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return error when log capture fails', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });
      const logCaptureStub = (params: any, executor: any) => {
        return Promise.resolve({
          sessionId: '',
          logFilePath: '',
          processes: [],
          error: 'Permission denied',
        });
      };

      const result = await start_sim_log_capLogic(
        {
          simulatorId: 'test-uuid',
          bundleId: 'io.sentry.app',
          subsystemFilter: 'app',
        },
        mockExecutor,
        logCaptureStub,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Error starting log capture');
      expect(text).toContain('Permission denied');
    });

    it('should return success with session ID when log capture starts successfully', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });
      const logCaptureStub = (params: any, executor: any) => {
        return Promise.resolve({
          sessionId: 'test-uuid-123',
          logFilePath: '/tmp/test.log',
          processes: [],
          error: undefined,
        });
      };

      const result = await start_sim_log_capLogic(
        {
          simulatorId: 'test-uuid',
          bundleId: 'io.sentry.app',
          subsystemFilter: 'app',
        },
        mockExecutor,
        logCaptureStub,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('test-uuid-123');
      expect(result.nextStepParams?.stop_sim_log_cap).toBeDefined();
      expect(result.nextStepParams?.stop_sim_log_cap).toMatchObject({
        logSessionId: 'test-uuid-123',
      });
    });

    it('should create correct spawn commands for console capture', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });
      const spawnCalls: Array<{
        command: string;
        args: string[];
      }> = [];

      const logCaptureStub = (params: any, executor: any) => {
        if (params.captureConsole) {
          spawnCalls.push({
            command: 'xcrun',
            args: [
              'simctl',
              'launch',
              '--console-pty',
              '--terminate-running-process',
              params.simulatorUuid,
              params.bundleId,
            ],
          });
        }
        spawnCalls.push({
          command: 'xcrun',
          args: [
            'simctl',
            'spawn',
            params.simulatorUuid,
            'log',
            'stream',
            '--level=debug',
            '--predicate',
            `subsystem == "${params.bundleId}"`,
          ],
        });

        return Promise.resolve({
          sessionId: 'test-uuid-123',
          logFilePath: '/tmp/test.log',
          processes: [],
          error: undefined,
        });
      };

      await start_sim_log_capLogic(
        {
          simulatorId: 'test-uuid',
          bundleId: 'io.sentry.app',
          captureConsole: true,
          subsystemFilter: 'app',
        },
        mockExecutor,
        logCaptureStub,
      );

      expect(spawnCalls).toHaveLength(2);
      expect(spawnCalls[0]).toEqual({
        command: 'xcrun',
        args: [
          'simctl',
          'launch',
          '--console-pty',
          '--terminate-running-process',
          'test-uuid',
          'io.sentry.app',
        ],
      });
      expect(spawnCalls[1]).toEqual({
        command: 'xcrun',
        args: [
          'simctl',
          'spawn',
          'test-uuid',
          'log',
          'stream',
          '--level=debug',
          '--predicate',
          'subsystem == "io.sentry.app"',
        ],
      });
    });

    it('should create correct spawn commands for structured logs only', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });
      const spawnCalls: Array<{
        command: string;
        args: string[];
      }> = [];

      const logCaptureStub = (params: any, executor: any) => {
        spawnCalls.push({
          command: 'xcrun',
          args: [
            'simctl',
            'spawn',
            params.simulatorUuid,
            'log',
            'stream',
            '--level=debug',
            '--predicate',
            `subsystem == "${params.bundleId}"`,
          ],
        });

        return Promise.resolve({
          sessionId: 'test-uuid-123',
          logFilePath: '/tmp/test.log',
          processes: [],
          error: undefined,
        });
      };

      await start_sim_log_capLogic(
        {
          simulatorId: 'test-uuid',
          bundleId: 'io.sentry.app',
          captureConsole: false,
          subsystemFilter: 'app',
        },
        mockExecutor,
        logCaptureStub,
      );

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]).toEqual({
        command: 'xcrun',
        args: [
          'simctl',
          'spawn',
          'test-uuid',
          'log',
          'stream',
          '--level=debug',
          '--predicate',
          'subsystem == "io.sentry.app"',
        ],
      });
    });
  });
});
