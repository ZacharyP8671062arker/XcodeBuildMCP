import { describe, it, expect, beforeEach } from 'vitest';
import { schema, handler, get_mac_bundle_idLogic } from '../get_mac_bundle_id.ts';
import {
  createMockFileSystemExecutor,
  createCommandMatchingMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('get_mac_bundle_id plugin', () => {
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

  describe('Plugin Structure', () => {
    it('should expose schema and handler', () => {
      expect(schema).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return error when file exists validation fails', async () => {
      const mockExecutor = createMockExecutorForCommands({});
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => false,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Get macOS Bundle ID');
      expect(text).toContain("File not found: '/Applications/MyApp.app'");
    });

    it('should return success with bundle ID using defaults read', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier':
          'io.sentry.MyMacApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        launch_mac_app: { appPath: '/Applications/MyApp.app' },
        build_macos: { scheme: 'SCHEME_NAME' },
      });
    });

    it('should fallback to PlistBuddy when defaults read fails', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          'io.sentry.MyMacApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        launch_mac_app: { appPath: '/Applications/MyApp.app' },
        build_macos: { scheme: 'SCHEME_NAME' },
      });
    });

    it('should return error when both extraction methods fail', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'Command failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          new Error('Command failed'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist');
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'Custom error message',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          new Error('Custom error message'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist');
    });

    it('should handle string errors in catch blocks', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'String error',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          new Error('String error'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await get_mac_bundle_idLogic(
        { appPath: '/Applications/MyApp.app' },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Could not extract bundle ID from Info.plist');
    });
  });
});
