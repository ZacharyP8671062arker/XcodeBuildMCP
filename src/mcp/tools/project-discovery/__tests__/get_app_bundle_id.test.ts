import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { schema, handler, get_app_bundle_idLogic } from '../get_app_bundle_id.ts';
import {
  createMockFileSystemExecutor,
  createCommandMatchingMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('get_app_bundle_id plugin', () => {
  const createMockExecutorForCommands = (results: Record<string, string | Error>) => {
    return createCommandMatchingMockExecutor(
      Object.fromEntries(
        Object.entries(results).map(([command, result]) => [
          command,
          result instanceof Error
            ? { success: false, error: result.message }
            : { success: true, output: result },
        ]),
      ),
    );
  };

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema with valid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ appPath: '/path/to/MyApp.app' }).success).toBe(true);
      expect(schemaObj.safeParse({ appPath: '/Users/dev/MyApp.app' }).success).toBe(true);
    });

    it('should validate schema with invalid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ appPath: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ appPath: null }).success).toBe(false);
      expect(schemaObj.safeParse({ appPath: undefined }).success).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return error when appPath validation fails', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('appPath');
    });

    it('should return error when file exists validation fails', async () => {
      const mockExecutor = createMockExecutorForCommands({});
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => false,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Get Bundle ID');
      expect(text).toContain("File not found: '/path/to/MyApp.app'");
    });

    it('should return success with bundle ID using defaults read', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/path/to/MyApp.app/Info" CFBundleIdentifier': 'io.sentry.MyApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Get Bundle ID');
      expect(text).toContain('Bundle ID: io.sentry.MyApp');
      expect(result.nextStepParams).toEqual({
        install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath: '/path/to/MyApp.app' },
        launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'io.sentry.MyApp' },
        install_app_device: { deviceId: 'DEVICE_UDID', appPath: '/path/to/MyApp.app' },
        launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'io.sentry.MyApp' },
      });
    });

    it('should fallback to PlistBuddy when defaults read fails', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/path/to/MyApp.app/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/path/to/MyApp.app/Info.plist"':
          'io.sentry.MyApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Bundle ID: io.sentry.MyApp');
      expect(result.nextStepParams).toEqual({
        install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath: '/path/to/MyApp.app' },
        launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'io.sentry.MyApp' },
        install_app_device: { deviceId: 'DEVICE_UDID', appPath: '/path/to/MyApp.app' },
        launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'io.sentry.MyApp' },
      });
    });

    it('should return error when both extraction methods fail', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/path/to/MyApp.app/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/path/to/MyApp.app/Info.plist"':
          new Error('Command failed'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist: Command failed');
      expect(text).toContain('Make sure the path points to a valid app bundle (.app directory).');
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/path/to/MyApp.app/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/path/to/MyApp.app/Info.plist"':
          new Error('Custom error message'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist: Custom error message');
      expect(text).toContain('Make sure the path points to a valid app bundle (.app directory).');
    });

    it('should handle string errors in catch blocks', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/path/to/MyApp.app/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/path/to/MyApp.app/Info.plist"':
          new Error('String error'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_app_bundle_idLogic(
        { appPath: '/path/to/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist: String error');
      expect(text).toContain('Make sure the path points to a valid app bundle (.app directory).');
    });

    it('should handle schema validation error when appPath is null', async () => {
      const result = await handler({ appPath: null });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('appPath');
      expect(result.content[0].text).toContain('null');
    });

    it('should handle schema validation with missing appPath', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('appPath');
    });

    it('should handle schema validation with undefined appPath', async () => {
      const result = await handler({ appPath: undefined });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('appPath');
    });

    it('should handle schema validation with number type appPath', async () => {
      const result = await handler({ appPath: 123 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('appPath');
      expect(result.content[0].text).toContain('number');
    });
  });
});
