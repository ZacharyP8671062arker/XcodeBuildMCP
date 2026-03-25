/**
 * Tests for test_sim plugin (session-aware version)
 * Follows CLAUDE.md guidance: dependency injection, no vi-mocks, literal validation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as z from 'zod';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, test_simLogic } from '../test_sim.ts';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import {
  isPendingXcodebuildResponse,
  finalizePendingXcodebuildResponse,
} from '../../../../utils/xcodebuild-output.ts';
import type { ToolResponse } from '../../../../types/common.ts';

function finalizeAndGetText(result: ToolResponse): string {
  if (isPendingXcodebuildResponse(result)) {
    const finalized = finalizePendingXcodebuildResponse(result);
    return finalized.content.map((c) => c.text).join('\n');
  }
  return result.content.map((c) => c.text).join('\n');
}

describe('test_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only non-session fields in public schema', () => {
      const schemaObj = z.strictObject(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(
        schemaObj.safeParse({
          extraArgs: ['--quiet'],
          testRunnerEnv: { FOO: 'BAR' },
        }).success,
      ).toBe(true);

      expect(schemaObj.safeParse({ derivedDataPath: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ extraArgs: ['--ok', 42] }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(schemaObj.safeParse({ testRunnerEnv: { FOO: 123 } }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'progress', 'testRunnerEnv'].sort());
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should require simulator identifier when scheme and project defaults exist', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        projectPath: '/path/to/project.xcodeproj',
      });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide simulatorId or simulatorName');
    });

    it('should error when both simulatorId and simulatorName provided explicitly', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      const result = await handler({
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('simulatorId');
      expect(result.content[0].text).toContain('simulatorName');
    });
  });

  describe('preflight output', () => {
    it('prints Flowdeck-style preflight in CLI text mode', async () => {
      const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;
      const originalOutputFormat = process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
      process.env.XCODEBUILDMCP_RUNTIME = 'cli';
      process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'text';

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const files = new Map<string, string>([
        [
          '/tmp/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
          `<?xml version="1.0" encoding="UTF-8"?>
<Scheme>
  <TestAction buildConfiguration = "Debug">
    <Testables>
      <TestableReference skipped = "NO">
        <BuildableReference BlueprintName = "AppTests" ReferencedContainer = "container:App.xcodeproj"></BuildableReference>
      </TestableReference>
    </Testables>
  </TestAction>
</Scheme>`,
        ],
        [
          '/tmp/AppTests/AppTests.swift',
          `import XCTest
final class AppTests: XCTestCase {
  func testLaunch() {}
}`,
        ],
      ]);

      let callCount = 0;
      const executor = async (
        command: string[],
        _description?: string,
        _useShell?: boolean,
        _opts?: { cwd?: string },
      ) => {
        if (command[0] === 'xcrun' && command[1] === 'simctl') {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({
              devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
                  { udid: 'SIM-UUID', name: 'iPhone 17 Pro' },
                ],
              },
            }),
          });
        }

        callCount += 1;
        if (callCount === 1) {
          return createMockCommandResponse({ success: true, output: 'BUILD SUCCEEDED' });
        }

        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({
            title: 'App Tests',
            result: 'SUCCEEDED',
            totalTestCount: 1,
            passedTests: 1,
            failedTests: 0,
            skippedTests: 0,
            expectedFailures: 0,
          }),
        });
      };

      try {
        const result = await test_simLogic(
          {
            projectPath: '/tmp/App.xcodeproj',
            scheme: 'App',
            simulatorName: 'iPhone 17 Pro',
            configuration: 'Debug',
            progress: false,
          },
          executor,
          createMockFileSystemExecutor({
            existsSync: (targetPath) =>
              files.has(targetPath) ||
              ['/tmp/AppTests', '/tmp/test-run/TestResults.xcresult'].includes(targetPath),
            readFile: async (targetPath) => files.get(targetPath) ?? '',
            readdir: async (targetPath) =>
              targetPath === '/tmp/AppTests' ? ['AppTests.swift'] : [],
            stat: async (targetPath) => ({
              isDirectory: () =>
                targetPath === '/tmp/AppTests' ||
                targetPath === '/tmp/test-run/TestResults.xcresult',
              mtimeMs: 0,
            }),
            mkdtemp: async () => '/tmp/test-run',
            tmpdir: () => '/tmp',
            rm: async () => {},
          }),
        );

        expect(isPendingXcodebuildResponse(result)).toBe(true);
        const stdoutOutput = stdoutWrite.mock.calls.flat().join('');
        const responseText = finalizeAndGetText(result);
        const allOutput = stdoutOutput + responseText;
        expect(allOutput).toContain('Scheme: App');
        expect(allOutput).toContain('Discovered 1 test(s):');
        expect(allOutput).toContain('AppTests/AppTests/testLaunch');
      } finally {
        stdoutWrite.mockRestore();
        if (originalRuntime === undefined) {
          delete process.env.XCODEBUILDMCP_RUNTIME;
        } else {
          process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
        }
        if (originalOutputFormat === undefined) {
          delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
        } else {
          process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = originalOutputFormat;
        }
      }
    });
  });
});
