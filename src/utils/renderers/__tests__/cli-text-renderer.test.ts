import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliTextRenderer } from '../cli-text-renderer.ts';

const reporter = {
  update: vi.fn<(message: string) => void>(),
  clear: vi.fn<() => void>(),
};

vi.mock('../../cli-progress-reporter.ts', () => ({
  createCliProgressReporter: () => reporter,
}));

describe('cli-text-renderer', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    reporter.update.mockReset();
    reporter.clear.mockReset();
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('renders one blank-line boundary between front matter and first runtime line', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: [
        '🚀 Build & Run',
        '',
        '  Scheme: MyApp',
        '  Project: /tmp/MyApp.xcodeproj',
        '  Configuration: Debug',
        '  Platform: macOS',
        '',
      ].join('\n'),
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('  Platform: macOS\n\n› Compiling\n');
  });

  it('uses transient interactive updates for active phases and durable writes for lasting events', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: '🚀 Build & Run\n\n  Scheme: MyApp\n\n',
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      level: 'info',
      message: 'Resolving app path',
      code: 'build-run-step',
      data: { step: 'resolve-app-path', status: 'started' },
    });

    renderer.onEvent({
      type: 'warning',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      message: 'unused variable',
      rawLine: '/tmp/MyApp.swift:10: warning: unused variable',
    });

    renderer.onEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:04.000Z',
      operation: 'BUILD',
      level: 'success',
      message: 'App path resolved',
      code: 'build-run-step',
      data: { step: 'resolve-app-path', status: 'succeeded', appPath: '/tmp/build/MyApp.app' },
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:05.000Z',
      operation: 'BUILD',
      status: 'SUCCEEDED',
    });

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Resolving app path...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).not.toContain('› Compiling\n');
    expect(output).not.toContain('› Resolving app path\n');
    expect(output).toContain('Warnings (1):');
    expect(output).toContain('unused variable');
    expect(output).toContain('✓ Resolving app path\n');
  });

  it('renders grouped sad-path diagnostics before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_sim',
      params: {},
      message: [
        '🚀 Build & Run',
        '',
        '  Scheme: MyApp',
        '  Project: /tmp/MyApp.xcodeproj',
        '  Configuration: Debug',
        '  Platform: iOS Simulator',
        '  Simulator: INVALID-SIM-ID-123',
        '',
      ].join('\n'),
    });

    renderer.onEvent({
      type: 'error',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      message: 'No available simulator matched: INVALID-SIM-ID-123',
      rawLine: 'No available simulator matched: INVALID-SIM-ID-123',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 1200,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Errors (1):');
    expect(output).toContain('  ✗ No available simulator matched: INVALID-SIM-ID-123');
    expect(output).toContain('❌ Build failed. (⏱️ 1.2s)');
  });

  it('groups compiler diagnostics under a nested failure header before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: [
        '🚀 Build & Run',
        '',
        '  Scheme: MyApp',
        '  Project: /tmp/MyApp.xcodeproj',
        '  Configuration: Debug',
        '  Platform: macOS',
        '',
      ].join('\n'),
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'error',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '› Compiling\n\nCompiler Errors (1):\n\n  ✗ unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('error: unterminated string literal\n  ContentView.swift:16:18');
    expect(output).toContain('\n\n❌ Build failed. (⏱️ 4.0s)');
  });

  it('uses exactly one blank-line boundary between front matter and compiler errors when no runtime line rendered', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: [
        '🚀 Build & Run',
        '',
        '  Scheme: MyApp',
        '  Project: /tmp/MyApp.xcodeproj',
        '  Configuration: Debug',
        '  Platform: macOS',
        '',
      ].join('\n'),
    });

    renderer.onEvent({
      type: 'error',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 2000,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '  Platform: macOS\n\nCompiler Errors (1):\n\n  ✗ unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('  Platform: macOS\n\n\nCompiler Errors (1):');
  });

  it('persists the last transient runtime phase as a durable line before grouped compiler errors', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: '🚀 Build & Run\n\n  Scheme: MyApp\n\n',
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      stage: 'LINKING',
      message: 'Linking',
    });

    renderer.onEvent({
      type: 'error',
      timestamp: '2026-03-20T12:00:03.000Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:04.000Z',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Linking...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '› Linking\n\nCompiler Errors (1):\n\n  ✗ unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
  });

  it('renders summary, execution-derived footer, and next steps in that order', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:05.000Z',
      operation: 'BUILD',
      status: 'SUCCEEDED',
      durationMs: 7100,
    });

    renderer.onEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:06.000Z',
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

    renderer.onEvent({
      type: 'next-steps',
      timestamp: '2026-03-20T12:00:07.000Z',
      steps: [{ label: 'Get built macOS app path', cliTool: 'get-app-path', workflow: 'macos' }],
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    const summaryIndex = output.indexOf('✅ Build succeeded.');
    const footerIndex = output.indexOf('✅ Build & Run complete');
    const nextStepsIndex = output.indexOf('Next steps:');

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(summaryIndex);
    expect(nextStepsIndex).toBeGreaterThan(footerIndex);
    expect(output).toContain('✅ Build & Run complete\n\n  └ App Path: /tmp/build/MyApp.app');
  });
});
