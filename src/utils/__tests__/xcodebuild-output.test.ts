import { beforeEach, describe, expect, it } from 'vitest';
import { startBuildPipeline } from '../xcodebuild-pipeline.ts';
import {
  createPendingXcodebuildResponse,
  finalizePendingXcodebuildResponse,
} from '../xcodebuild-output.ts';

describe('xcodebuild-output', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, XCODEBUILDMCP_RUNTIME: 'mcp' };
    delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
  });

  it('suppresses fallback error content when structured diagnostics already exist', () => {
    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: { scheme: 'MyApp' },
      message: '\u{1F680} Build & Run\n\n  Scheme: MyApp\n\n',
    });

    started.pipeline.emitEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:00.500Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MyApp.swift:10:1: error: unterminated string literal',
    });

    const pending = createPendingXcodebuildResponse(
      started,
      {
        content: [{ type: 'text', text: 'Legacy fallback error block' }],
        isError: true,
      },
      {
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      },
    );

    const finalized = finalizePendingXcodebuildResponse(pending);
    const textContent = finalized.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    expect(textContent).toContain('Compiler Errors (1):');
    expect(textContent).toContain('  \u2717 unterminated string literal');
    expect(textContent).toContain('    /tmp/MyApp.swift:10:1');
    expect(textContent).not.toContain('error: unterminated string literal');
    expect(textContent).not.toContain('Legacy fallback error block');
  });

  it('preserves fallback error content when no structured diagnostics exist', () => {
    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: { scheme: 'MyApp' },
      message: '\u{1F680} Build & Run\n\n  Scheme: MyApp\n\n',
    });

    const pending = createPendingXcodebuildResponse(
      started,
      {
        content: [{ type: 'text', text: 'Legacy fallback error block' }],
        isError: true,
      },
      {
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      },
    );

    const finalized = finalizePendingXcodebuildResponse(pending);
    const textContent = finalized.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    expect(textContent).toContain('Legacy fallback error block');
  });

  it('never appends next steps to failed pending xcodebuild responses', () => {
    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: { scheme: 'MyApp' },
      message: '\u{1F680} Build & Run\n\n  Scheme: MyApp\n\n',
    });

    started.pipeline.emitEvent({
      type: 'compiler-error',
      timestamp: '2026-03-20T12:00:00.500Z',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MyApp.swift:10:1: error: unterminated string literal',
    });

    const pending = createPendingXcodebuildResponse(
      started,
      {
        content: [],
        isError: true,
      },
      {
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      },
    );

    const finalized = finalizePendingXcodebuildResponse(pending, {
      nextSteps: [{ label: 'Should not render', cliTool: 'get-app-path', workflow: 'macos' }],
    });

    const events = (finalized._meta?.events ?? []) as Array<{ type: string }>;
    expect(events.some((event) => event.type === 'next-steps')).toBe(false);

    const textContent = finalized.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    expect(textContent).not.toContain('Next steps:');
    expect(textContent).not.toContain('Should not render');
  });

  it('finalizes summary, execution-derived footer, then next steps in order', () => {
    const started = startBuildPipeline({
      operation: 'BUILD',
      toolName: 'build_run_macos',
      params: { scheme: 'MyApp' },
      message: '\u{1F680} Build & Run\n\n  Scheme: MyApp',
    });

    const pending = createPendingXcodebuildResponse(
      started,
      {
        content: [],
        isError: false,
      },
      {
        tailEvents: [
          {
            type: 'status-line',
            timestamp: '2026-03-20T12:00:01.000Z',
            level: 'success',
            message: 'Build & Run complete',
          },
          {
            type: 'detail-tree',
            timestamp: '2026-03-20T12:00:01.000Z',
            items: [{ label: 'App Path', value: '/tmp/build/MyApp.app' }],
          },
        ],
      },
    );

    const finalized = finalizePendingXcodebuildResponse(pending, {
      nextSteps: [
        { label: 'Get built macOS app path', cliTool: 'get-app-path', workflow: 'macos' },
      ],
    });

    const events = (finalized._meta?.events ?? []) as Array<{ type: string }>;
    const lastThreeTypes = events.slice(-4).map((e) => e.type);
    expect(lastThreeTypes).toContain('summary');
    expect(lastThreeTypes).toContain('status-line');
    expect(lastThreeTypes).toContain('detail-tree');
    expect(lastThreeTypes).toContain('next-steps');

    const textContent = finalized.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text);

    expect(textContent.at(-1)).toContain('Next steps:');
    expect(textContent.some((t) => t.includes('\u{2705} Build & Run complete'))).toBe(true);
  });
});
