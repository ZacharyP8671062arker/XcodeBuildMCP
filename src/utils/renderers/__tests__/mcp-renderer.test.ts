import { describe, expect, it } from 'vitest';
import { createMcpRenderer } from '../mcp-renderer.ts';

describe('mcp-renderer', () => {
  it('buffers the same sad-path diagnostic text semantics as CLI', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    renderer.onEvent({
      type: 'compiler-error',
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

    expect(textItems[0]).toContain('Build & Run');

    const allText = textItems.join('\n');
    expect(allText).toContain('Errors (1):');
    expect(allText).toContain('  \u2717 No available simulator matched: INVALID-SIM-ID-123');
    expect(allText).toContain('\u{274C} Build failed. (\u{23F1}\u{FE0F} 1.2s)');
  });

  it('buffers grouped compiler diagnostics before the failed summary', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    renderer.onEvent({
      type: 'compiler-error',
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
    expect(textItems[1]).toContain('  \u2717 unterminated string literal');
    expect(textItems[1]).toContain('    /tmp/MCPTest/ContentView.swift:16:18');
    expect(textItems[1]).not.toContain('error: unterminated string literal');
    expect(textItems[2]).toContain('\u{274C} Build failed. (\u{23F1}\u{FE0F} 4.0s)');
  });

  it('buffers the same formatted sections in order and keeps next steps last', () => {
    const renderer = createMcpRenderer();

    renderer.onEvent({
      type: 'header',
      timestamp: '2026-03-20T12:00:00.000Z',
      operation: 'Build & Run',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    renderer.onEvent({
      type: 'build-stage',
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
      type: 'status-line',
      timestamp: '2026-03-20T12:00:03.000Z',
      level: 'success',
      message: 'Build & Run complete',
    });

    renderer.onEvent({
      type: 'detail-tree',
      timestamp: '2026-03-20T12:00:03.000Z',
      items: [{ label: 'App Path', value: '/tmp/build/MyApp.app' }],
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

    expect(textItems[0]).toContain('Build & Run');
    expect(textItems[1]).toBe('\u203A Compiling');
    expect(textItems[2]).toContain('\u{2705} Build succeeded.');
    expect(textItems[3]).toContain('\u{2705} Build & Run complete');
    expect(textItems[4]).toContain('\u2514 App Path: /tmp/build/MyApp.app');
    expect(textItems.at(-1)).toContain('Next steps:');
  });
});
