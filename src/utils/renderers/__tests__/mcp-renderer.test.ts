import { describe, expect, it } from 'vitest';
import { createMcpRenderer } from '../mcp-renderer.ts';

describe('mcp-renderer', () => {
  it('buffers the same sad-path diagnostic text semantics as CLI', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_sim',
      params: {},
      message: '🚀 Build & Run\n\n  Scheme: MyApp\n\n',
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

    const textItems = renderer
      .getContent()
      .filter((item) => item.type === 'text')
      .map((item) => item.text);

    expect(textItems[0]).toContain('🚀 Build & Run');

    const allText = textItems.join('\n');
    expect(allText).toContain('Errors (1):');
    expect(allText).toContain('  ✗ No available simulator matched: INVALID-SIM-ID-123');
    expect(allText).toContain('❌ Build failed. (⏱️ 1.2s)');
  });

  it('buffers grouped compiler diagnostics before the failed summary', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: '🚀 Build & Run\n\n  Scheme: MyApp\n\n',
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
      durationMs: 4000,
    });

    const textItems = renderer
      .getContent()
      .filter((item) => item.type === 'text')
      .map((item) => item.text);

    expect(textItems[1]).toContain('Compiler Errors (1):');
    expect(textItems[1]).toContain('  ✗ unterminated string literal');
    expect(textItems[1]).toContain('    /tmp/MCPTest/ContentView.swift:16:18');
    expect(textItems[1]).not.toContain('error: unterminated string literal');
    expect(textItems[2]).toContain('❌ Build failed. (⏱️ 4.0s)');
  });

  it('buffers the same formatted sections in order and keeps next steps last', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'start',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: {},
      message: '🚀 Build & Run\n\n  Scheme: MyApp',
    });

    renderer.onEvent({
      type: 'status',
      timestamp: '2026-03-20T12:00:01.000Z',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onEvent({
      type: 'summary',
      timestamp: '2026-03-20T12:00:02.000Z',
      operation: 'BUILD',
      status: 'SUCCEEDED',
      durationMs: 7100,
    });

    renderer.onEvent({
      type: 'notice',
      timestamp: '2026-03-20T12:00:03.000Z',
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
      timestamp: '2026-03-20T12:00:04.000Z',
      steps: [{ label: 'Get built macOS app path', cliTool: 'get-app-path', workflow: 'macos' }],
    });

    const textItems = renderer
      .getContent()
      .filter((item) => item.type === 'text')
      .map((item) => item.text);

    expect(textItems[0]).toContain('🚀 Build & Run');
    expect(textItems[1]).toBe('› Compiling');
    expect(textItems[2]).toContain('✅ Build succeeded.');
    expect(textItems[3]).toContain('✅ Build & Run complete');
    expect(textItems[3]).toContain('\n\n  └ App Path: /tmp/build/MyApp.app');
    expect(textItems[3]).not.toContain('Scheme:');
    expect(textItems[3]).not.toContain('Target:');
    expect(textItems.at(-1)).toContain('Next steps:');
  });
});
