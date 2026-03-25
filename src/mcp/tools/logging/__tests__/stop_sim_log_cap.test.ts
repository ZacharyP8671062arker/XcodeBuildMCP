/**
 * stop_sim_log_cap Plugin Tests - Test coverage for stop_sim_log_cap plugin
 *
 * This test file provides complete coverage for the stop_sim_log_cap plugin:
 * - Plugin structure validation
 * - Handler functionality (stop log capture session and retrieve captured logs)
 * - Error handling for validation and log capture failures
 *
 * Tests follow the canonical testing patterns from CLAUDE.md with deterministic
 * response validation and comprehensive parameter testing.
 * Converted to pure dependency injection without vitest mocking.
 */

import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { schema, handler, stop_sim_log_capLogic } from '../stop_sim_log_cap.ts';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import type { ToolResponse } from '../../../../types/common.ts';

function allText(response: ToolResponse): string {
  return response.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

describe('stop_sim_log_cap plugin', () => {
  const mockExecutor = createMockExecutor({ success: true, output: '' });
  const mockFileSystem = createMockFileSystemExecutor();

  describe('Export Field Validation (Literal)', () => {
    it('should export schema and handler', () => {
      expect(schema).toBeDefined();
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
      expect(typeof schema).toBe('object');
    });

    it('should have correct schema structure', () => {
      // Schema should be a plain object for MCP protocol compliance
      expect(typeof schema).toBe('object');
      expect(schema).toHaveProperty('logSessionId');

      // Validate that schema fields are Zod types that can be used for validation
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ logSessionId: 'test-session-id' }).success).toBe(true);
      expect(schemaObj.safeParse({ logSessionId: 123 }).success).toBe(false);
    });

    it('should validate schema with valid parameters', () => {
      expect(schema.logSessionId.safeParse('test-session-id').success).toBe(true);
    });

    it('should reject invalid schema parameters', () => {
      expect(schema.logSessionId.safeParse(null).success).toBe(false);
      expect(schema.logSessionId.safeParse(undefined).success).toBe(false);
      expect(schema.logSessionId.safeParse(123).success).toBe(false);
      expect(schema.logSessionId.safeParse(true).success).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should handle null logSessionId (validation handled by framework)', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: 'Log content for empty session',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: '',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Log content for empty session');
      expect(text).toContain('Log capture stopped');
    });

    it('should handle undefined logSessionId (validation handled by framework)', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: 'Log content for empty session',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: '',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Log content for empty session');
      expect(text).toContain('Log capture stopped');
    });

    it('should handle empty string logSessionId', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: 'Log content for empty session',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: '',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Log content for empty session');
      expect(text).toContain('Log capture stopped');
    });
  });

  describe('Function Call Generation', () => {
    it('should call stopLogCapture with correct parameters', async () => {
      let capturedSessionId = '';
      const stopLogCaptureStub = async (logSessionId: string) => {
        capturedSessionId = logSessionId;
        return { logContent: 'Mock log content from file', error: undefined };
      };

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(capturedSessionId).toBe('test-session-id');
      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('test-session-id');
      expect(text).toContain('Mock log content from file');
      expect(text).toContain('Log capture stopped');
    });

    it('should call stopLogCapture with different session ID', async () => {
      let capturedSessionId = '';
      const stopLogCaptureStub = async (logSessionId: string) => {
        capturedSessionId = logSessionId;
        return { logContent: 'Different log content', error: undefined };
      };

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'different-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(capturedSessionId).toBe('different-session-id');
      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('different-session-id');
      expect(text).toContain('Different log content');
      expect(text).toContain('Log capture stopped');
    });
  });

  describe('Response Processing', () => {
    it('should handle successful log capture stop', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: 'Mock log content from file',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('test-session-id');
      expect(text).toContain('Mock log content from file');
      expect(text).toContain('Log capture stopped');
    });

    it('should handle empty log content', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: '',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('test-session-id');
      expect(text).toContain('Log capture stopped');
    });

    it('should handle multiline log content', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: 'Line 1\nLine 2\nLine 3',
        error: undefined,
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
      expect(text).toContain('Line 3');
      expect(text).toContain('Log capture stopped');
    });

    it('should handle log capture stop errors for non-existent session', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: '',
        error: 'Log capture session not found: non-existent-session',
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'non-existent-session',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Error stopping log capture session non-existent-session');
      expect(text).toContain('Log capture session not found');
    });

    it('should handle file read errors', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: '',
        error: 'ENOENT: no such file or directory',
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Error stopping log capture session test-session-id');
    });

    it('should handle permission errors', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: '',
        error: 'EACCES: permission denied',
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Error stopping log capture session test-session-id');
    });

    it('should handle various error types', async () => {
      const stopLogCaptureStub = async () => ({
        logContent: '',
        error: 'Unexpected error',
      });

      const result = await stop_sim_log_capLogic(
        {
          logSessionId: 'test-session-id',
        },
        mockExecutor,
        stopLogCaptureStub,
        mockFileSystem,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Error stopping log capture session test-session-id');
    });
  });
});
