import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  type CommandExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, sim_statusbarLogic } from '../sim_statusbar.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('sim_statusbar tool', () => {
  describe('Schema Validation', () => {
    it('should expose public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ dataNetwork: 'wifi' }).success).toBe(true);
      expect(schemaObj.safeParse({ dataNetwork: 'clear' }).success).toBe(true);
      expect(schemaObj.safeParse({ dataNetwork: 'invalid' }).success).toBe(false);

      const withSimId = schemaObj.safeParse({ simulatorId: 'test-uuid', dataNetwork: 'wifi' });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as object)).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should handle successful status bar data network setting', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Status bar set successfully',
      });

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'wifi',
        },
        mockExecutor,
      );

      const text = allText(result);
      expect(text).toContain('Statusbar');
      expect(text).toContain('Status bar data network set successfully');
      expect(result.isError).toBeFalsy();
    });

    it('should handle minimal valid parameters (Zod handles validation)', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Status bar set successfully',
      });

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'wifi',
        },
        mockExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Status bar data network set successfully');
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Simulator not found',
      });

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'invalid-uuid',
          dataNetwork: '3g',
        },
        mockExecutor,
      );

      const text = allText(result);
      expect(text).toContain('Failed to set status bar: Simulator not found');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor: CommandExecutor = async () => {
        throw new Error('Connection failed');
      };

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: '4g',
        },
        mockExecutor,
      );

      const text = allText(result);
      expect(text).toContain('Failed to set status bar: Connection failed');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with string error', async () => {
      const mockExecutor: CommandExecutor = async () => {
        throw 'String error';
      };

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'lte',
        },
        mockExecutor,
      );

      const text = allText(result);
      expect(text).toContain('Failed to set status bar: String error');
      expect(result.isError).toBe(true);
    });

    it('should verify command generation with mock executor for override', async () => {
      const calls: Array<{
        command: string[];
        operationDescription?: string;
        keepAlive?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor: CommandExecutor = async (
        command,
        operationDescription,
        keepAlive,
        opts,
        detached,
      ) => {
        calls.push({ command, operationDescription, keepAlive, opts });
        void detached;
        return createMockCommandResponse({
          success: true,
          output: 'Status bar set successfully',
          error: undefined,
        });
      };

      await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'wifi',
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: [
          'xcrun',
          'simctl',
          'status_bar',
          'test-uuid-123',
          'override',
          '--dataNetwork',
          'wifi',
        ],
        operationDescription: 'Set Status Bar',
        keepAlive: false,
        opts: undefined,
      });
    });

    it('should verify command generation for clear operation', async () => {
      const calls: Array<{
        command: string[];
        operationDescription?: string;
        keepAlive?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor: CommandExecutor = async (
        command,
        operationDescription,
        keepAlive,
        opts,
        detached,
      ) => {
        calls.push({ command, operationDescription, keepAlive, opts });
        void detached;
        return createMockCommandResponse({
          success: true,
          output: 'Status bar cleared successfully',
          error: undefined,
        });
      };

      await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'clear',
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: ['xcrun', 'simctl', 'status_bar', 'test-uuid-123', 'clear'],
        operationDescription: 'Set Status Bar',
        keepAlive: false,
        opts: undefined,
      });
    });

    it('should handle successful clear operation', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Status bar cleared successfully',
      });

      const result = await sim_statusbarLogic(
        {
          simulatorId: 'test-uuid-123',
          dataNetwork: 'clear',
        },
        mockExecutor,
      );

      const text = allText(result);
      expect(text).toContain('Status bar overrides cleared');
      expect(result.isError).toBeFalsy();
    });
  });
});
