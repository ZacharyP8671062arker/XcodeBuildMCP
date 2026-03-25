import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createXcodebuildPipeline } from '../xcodebuild-pipeline.ts';
import { STAGE_RANK } from '../../types/pipeline-events.ts';

describe('xcodebuild-pipeline', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces MCP content from xcodebuild test output', () => {
    const pipeline = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: { scheme: 'MyApp' },
    });

    pipeline.emitEvent({
      type: 'header',
      timestamp: '2025-01-01T00:00:00.000Z',
      operation: 'Test',
      params: [{ label: 'Scheme', value: 'MyApp' }],
    });

    pipeline.onStdout('Resolve Package Graph\n');
    pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    pipeline.onStdout("Test Case '-[Suite testA]' passed (0.001 seconds)\n");
    pipeline.onStdout("Test Case '-[Suite testB]' failed (0.002 seconds)\n");

    const result = pipeline.finalize(false, 2345);

    expect(result.state.finalStatus).toBe('FAILED');
    expect(result.state.completedTests).toBe(2);
    expect(result.state.failedTests).toBe(1);
    expect(result.state.milestones.map((m) => m.stage)).toContain('RESOLVING_PACKAGES');
    expect(result.state.milestones.map((m) => m.stage)).toContain('COMPILING');

    // MCP content should have text entries
    expect(result.mcpContent.length).toBeGreaterThan(0);
    const texts = result.mcpContent
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text);
    expect(texts.some((t) => t.includes('Test'))).toBe(true);
    expect(texts.some((t) => t.includes('Resolving packages'))).toBe(true);

    // Events array should contain all events
    expect(result.events.length).toBeGreaterThan(0);
    const eventTypes = result.events.map((e) => e.type);
    expect(eventTypes).toContain('header');
    expect(eventTypes).toContain('build-stage');
    expect(eventTypes).toContain('test-progress');
    expect(eventTypes).toContain('summary');
  });

  it('handles build output with warnings and errors', () => {
    const pipeline = createXcodebuildPipeline({
      operation: 'BUILD',
      toolName: 'build_sim',
      params: { scheme: 'MyApp' },
    });

    pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    pipeline.onStdout('/tmp/App.swift:10:5: warning: variable unused\n');
    pipeline.onStdout("/tmp/App.swift:20:3: error: type 'Foo' has no member 'bar'\n");

    const result = pipeline.finalize(false, 500);

    expect(result.state.warnings).toHaveLength(1);
    expect(result.state.errors).toHaveLength(1);
    expect(result.state.finalStatus).toBe('FAILED');
  });

  it('supports multi-phase with minimumStage', () => {
    // Phase 1: build-for-testing
    const phase1 = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
    });

    phase1.onStdout('Resolve Package Graph\n');
    phase1.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');

    const phase1Rank = phase1.highestStageRank();
    expect(phase1Rank).toBe(STAGE_RANK.COMPILING);

    phase1.finalize(true, 1000);

    // Phase 2: test-without-building, skipping stages already seen
    const stageEntries = Object.entries(STAGE_RANK) as Array<[string, number]>;
    const minStage = stageEntries.find(([, rank]) => rank === phase1Rank)?.[0] as
      | 'COMPILING'
      | undefined;

    const phase2 = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
      minimumStage: minStage,
    });

    // These should be suppressed
    phase2.onStdout('Resolve Package Graph\n');
    phase2.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
    // This should pass through
    phase2.onStdout("Test Case '-[Suite testA]' passed (0.001 seconds)\n");

    const result = phase2.finalize(true, 2000);

    // Only RUN_TESTS milestone (auto-inserted from test-progress), not RESOLVING_PACKAGES or COMPILING
    const milestoneStages = result.state.milestones.map((m) => m.stage);
    expect(milestoneStages).not.toContain('RESOLVING_PACKAGES');
    expect(milestoneStages).not.toContain('COMPILING');
    expect(milestoneStages).toContain('RUN_TESTS');
    expect(result.state.completedTests).toBe(1);
  });

  it('emitEvent passes tool-originated events through the pipeline', () => {
    const pipeline = createXcodebuildPipeline({
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
    });

    pipeline.emitEvent({
      type: 'test-discovery',
      timestamp: '2025-01-01T00:00:00.000Z',
      operation: 'TEST',
      total: 3,
      tests: ['testA', 'testB', 'testC'],
      truncated: false,
    });

    const result = pipeline.finalize(true, 100);

    const discoveryEvents = result.events.filter((e) => e.type === 'test-discovery');
    expect(discoveryEvents).toHaveLength(1);
  });

  it('produces JSONL output in CLI json mode', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'json';

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const pipeline = createXcodebuildPipeline({
        operation: 'BUILD',
        toolName: 'build_sim',
        params: {},
      });

      pipeline.onStdout('CompileSwift normal arm64 /tmp/App.swift\n');
      pipeline.finalize(true, 100);

      const jsonlCalls = writeSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].endsWith('\n'),
      );
      expect(jsonlCalls.length).toBeGreaterThan(0);

      // Each JSONL line should be valid JSON
      for (const call of jsonlCalls) {
        const line = (call[0] as string).trim();
        if (line) {
          const parsed = JSON.parse(line);
          expect(parsed).toHaveProperty('type');
          expect(parsed).toHaveProperty('timestamp');
        }
      }
    } finally {
      writeSpy.mockRestore();
    }
  });
});
