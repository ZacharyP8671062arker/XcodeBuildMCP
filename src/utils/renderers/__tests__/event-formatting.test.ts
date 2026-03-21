import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractGroupedCompilerError,
  formatGroupedCompilerErrors,
  formatHumanErrorEvent,
  formatHumanWarningEvent,
  formatNoticeEvent,
  formatStartEvent,
  formatStatusEvent,
  formatTransientNoticeEvent,
  formatTransientStatusEvent,
} from '../event-formatting.ts';

describe('event formatting', () => {
  it('formats start events as the provided preflight block', () => {
    expect(
      formatStartEvent({
        type: 'start',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        toolName: 'build_run_macos',
        params: {},
        message: '🚀 Build & Run\n\n  Scheme: MyApp',
      }),
    ).toBe('🚀 Build & Run\n\n  Scheme: MyApp');
  });

  it('formats status events as durable phase lines', () => {
    expect(
      formatStatusEvent({
        type: 'status',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        stage: 'COMPILING',
        message: 'Compiling',
      }),
    ).toBe('› Compiling');
  });

  it('formats transient status events for interactive runtime updates', () => {
    expect(
      formatTransientStatusEvent({
        type: 'status',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        stage: 'COMPILING',
        message: 'Compiling',
      }),
    ).toBe('Compiling...');
  });

  it('formats compiler-style errors with a cwd-relative source location when possible', () => {
    const projectBaseDir = join(process.cwd(), 'example_projects/macOS');

    expect(
      formatHumanErrorEvent(
        {
          type: 'error',
          timestamp: '2026-03-20T12:00:00.000Z',
          operation: 'BUILD',
          message: 'unterminated string literal',
          rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
        },
        { baseDir: projectBaseDir },
      ),
    ).toBe(
      [
        'error: unterminated string literal',
        '  example_projects/macOS/MCPTest/ContentView.swift:16:18',
      ].join('\n'),
    );
  });

  it('keeps compiler-style error paths absolute when they are outside cwd', () => {
    expect(
      formatHumanErrorEvent({
        type: 'error',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'unterminated string literal',
        rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
      }),
    ).toBe(
      ['error: unterminated string literal', '  /tmp/MCPTest/ContentView.swift:16:18'].join('\n'),
    );
  });

  it('formats tool-originated errors in xcodebuild-style form', () => {
    expect(
      formatHumanErrorEvent({
        type: 'error',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'No available simulator matched: INVALID-SIM-ID-123',
        rawLine: 'No available simulator matched: INVALID-SIM-ID-123',
      }),
    ).toBe('error: No available simulator matched: INVALID-SIM-ID-123');
  });

  it('extracts compiler diagnostics for grouped sad-path rendering', () => {
    expect(
      extractGroupedCompilerError(
        {
          type: 'error',
          timestamp: '2026-03-20T12:00:00.000Z',
          operation: 'BUILD',
          message: 'unterminated string literal',
          rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
        },
        { baseDir: join(process.cwd(), 'example_projects/macOS') },
      ),
    ).toEqual({
      message: 'unterminated string literal',
      location: 'example_projects/macOS/MCPTest/ContentView.swift:16:18',
    });
  });

  it('formats grouped compiler errors without repeating the error prefix per line', () => {
    expect(
      formatGroupedCompilerErrors(
        [
          {
            type: 'error',
            timestamp: '2026-03-20T12:00:00.000Z',
            operation: 'BUILD',
            message: 'unterminated string literal',
            rawLine: 'ContentView.swift:16:18: error: unterminated string literal',
          },
        ],
        { baseDir: join(process.cwd(), 'example_projects/macOS') },
      ),
    ).toBe(
      [
        'Compiler Errors (1):',
        '',
        '  ✗ unterminated string literal',
        '    example_projects/macOS/MCPTest/ContentView.swift:16:18',
      ].join('\n'),
    );
  });

  it('formats tool-originated warnings with warning emoji', () => {
    expect(
      formatHumanWarningEvent({
        type: 'warning',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        message: 'Using cached build products',
        rawLine: 'Using cached build products',
      }),
    ).toBe('  \u{26A0} Using cached build products');
  });

  it('formats structured build-run step notices', () => {
    expect(
      formatNoticeEvent({
        type: 'notice',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        level: 'info',
        message: 'Resolving app path',
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'started' },
      }),
    ).toBe('› Resolving app path');
  });

  it('formats transient build-run step notices only for started steps', () => {
    expect(
      formatTransientNoticeEvent({
        type: 'notice',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        level: 'info',
        message: 'Resolving app path',
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'started' },
      }),
    ).toBe('Resolving app path...');

    expect(
      formatTransientNoticeEvent({
        type: 'notice',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        level: 'success',
        message: 'App path resolved',
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'succeeded', appPath: '/tmp/build/MyApp.app' },
      }),
    ).toBeNull();
  });

  it('formats structured build-run result notices as a summary block', () => {
    expect(
      formatNoticeEvent({
        type: 'notice',
        timestamp: '2026-03-20T12:00:00.000Z',
        operation: 'BUILD',
        level: 'success',
        message: 'Build & Run complete',
        code: 'build-run-result',
        data: {
          scheme: 'MyApp',
          platform: 'macOS',
          target: 'macOS',
          appPath: '/tmp/build/MyApp.app',
          launchState: 'requested',
        },
      }),
    ).toBe(['✅ Build & Run complete', '', '  └ App Path: /tmp/build/MyApp.app'].join('\n'));
  });

  it('does not duplicate front-matter fields in the final build-run footer', () => {
    const rendered = formatNoticeEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      level: 'success',
      message: 'Build & Run complete',
      code: 'build-run-result',
      data: {
        scheme: 'MyApp',
        platform: 'macOS',
        target: 'macOS',
        appPath: '/tmp/build/MyApp.app',
        launchState: 'requested',
      },
    });

    expect(rendered).toContain('\n\n  └ App Path: /tmp/build/MyApp.app');
    expect(rendered).not.toContain('Scheme:');
    expect(rendered).not.toContain('Platform:');
    expect(rendered).not.toContain('Target:');
    expect(rendered).not.toContain('Configuration:');
    expect(rendered).not.toContain('Project:');
    expect(rendered).not.toContain('Workspace:');
  });

  it('renders all execution-derived footer values as a tree section', () => {
    const rendered = formatNoticeEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      level: 'success',
      message: 'Build & Run complete',
      code: 'build-run-result',
      data: {
        scheme: 'MyApp',
        platform: 'macOS',
        target: 'macOS',
        appPath: '/tmp/build/MyApp.app',
        bundleId: 'com.example.myapp',
        appId: 'A1B2C3D4',
        processId: 12345,
        launchState: 'running',
      },
    });

    expect(rendered).toContain('✅ Build & Run complete\n\n');
    expect(rendered).toContain('  ├ App Path: /tmp/build/MyApp.app');
    expect(rendered).toContain('  ├ Bundle ID: com.example.myapp');
    expect(rendered).toContain('  ├ App ID: A1B2C3D4');
    expect(rendered).toContain('  ├ Process ID: 12345');
    expect(rendered).toContain('  └ Launch: Running');
    expect(rendered).not.toContain('Scheme:');
    expect(rendered).not.toContain('Platform:');
    expect(rendered).not.toContain('Target:');
    expect(rendered).not.toContain('Configuration:');
    expect(rendered).not.toContain('Project:');
    expect(rendered).not.toContain('Workspace:');
  });
});
