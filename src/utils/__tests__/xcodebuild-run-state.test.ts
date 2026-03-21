import { describe, expect, it } from 'vitest';
import { createXcodebuildRunState } from '../xcodebuild-run-state.ts';
import type { XcodebuildEvent } from '../../types/xcodebuild-events.ts';
import { STAGE_RANK } from '../../types/xcodebuild-events.ts';

function ts(): string {
  return '2025-01-01T00:00:00.000Z';
}

describe('xcodebuild-run-state', () => {
  it('accepts status events and tracks milestones in order', () => {
    const forwarded: XcodebuildEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RUN_TESTS',
      message: 'Running tests',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(3);
    expect(snap.milestones.map((m) => m.stage)).toEqual([
      'RESOLVING_PACKAGES',
      'COMPILING',
      'RUN_TESTS',
    ]);
    expect(snap.currentStage).toBe('RUN_TESTS');
    expect(forwarded).toHaveLength(3);
  });

  it('deduplicates milestones at or below current rank', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    // Duplicate: should be ignored
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(2);
  });

  it('respects minimumStage for multi-phase continuation', () => {
    const state = createXcodebuildRunState({
      operation: 'TEST',
      minimumStage: 'COMPILING',
    });

    // These should be suppressed because they're at or below COMPILING rank
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    // This should be accepted
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RUN_TESTS',
      message: 'Running tests',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(1);
    expect(snap.milestones[0].stage).toBe('RUN_TESTS');
  });

  it('deduplicates error diagnostics by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    const error: XcodebuildEvent = {
      type: 'error',
      timestamp: ts(),
      operation: 'BUILD',
      message: 'type mismatch',
      location: '/tmp/App.swift:8',
      rawLine: '/tmp/App.swift:8:17: error: type mismatch',
    };

    state.push(error);
    state.push(error);

    const snap = state.snapshot();
    expect(snap.errors).toHaveLength(1);
  });

  it('deduplicates test failures by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    const failure: XcodebuildEvent = {
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'Suite',
      test: 'testA',
      message: 'assertion failed',
      location: '/tmp/Test.swift:10',
    };

    state.push(failure);
    state.push(failure);

    const snap = state.snapshot();
    expect(snap.testFailures).toHaveLength(1);
  });

  it('deduplicates warnings by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    const warning: XcodebuildEvent = {
      type: 'warning',
      timestamp: ts(),
      operation: 'BUILD',
      message: 'unused variable',
      location: '/tmp/App.swift:5',
      rawLine: '/tmp/App.swift:5: warning: unused variable',
    };

    state.push(warning);
    state.push(warning);

    const snap = state.snapshot();
    expect(snap.warnings).toHaveLength(1);
  });

  it('tracks test counts from test-progress events', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 2,
      failed: 1,
      skipped: 0,
    });
    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 3,
      failed: 1,
      skipped: 1,
    });

    const snap = state.snapshot();
    expect(snap.completedTests).toBe(3);
    expect(snap.failedTests).toBe(1);
    expect(snap.skippedTests).toBe(1);
  });

  it('auto-inserts RUN_TESTS milestone on first test-progress', () => {
    const forwarded: XcodebuildEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 1,
      failed: 0,
      skipped: 0,
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(1);
    expect(snap.milestones[0].stage).toBe('RUN_TESTS');
    // RUN_TESTS status + test-progress both forwarded
    expect(forwarded).toHaveLength(2);
  });

  it('finalize emits summary event and sets final status', () => {
    const forwarded: XcodebuildEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 5,
      failed: 2,
      skipped: 0,
    });

    const finalState = state.finalize(false, 1234);

    expect(finalState.finalStatus).toBe('FAILED');
    expect(finalState.wallClockDurationMs).toBe(1234);

    const summaryEvents = finalState.events.filter((e) => e.type === 'summary');
    expect(summaryEvents).toHaveLength(1);

    const summary = summaryEvents[0]!;
    if (summary.type === 'summary') {
      expect(summary.status).toBe('FAILED');
      expect(summary.totalTests).toBe(5);
      expect(summary.failedTests).toBe(2);
      expect(summary.passedTests).toBe(3);
      expect(summary.durationMs).toBe(1234);
    }
  });

  it('highestStageRank returns correct rank for multi-phase handoff', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'status',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    expect(state.highestStageRank()).toBe(STAGE_RANK.COMPILING);
  });

  it('passes through start and next-steps events', () => {
    const forwarded: XcodebuildEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'start',
      timestamp: ts(),
      operation: 'TEST',
      toolName: 'test_sim',
      params: {},
      message: 'Starting test run',
    });
    state.push({
      type: 'next-steps',
      timestamp: ts(),
      steps: [{ tool: 'foo' }],
    });

    expect(forwarded).toHaveLength(2);
    expect(forwarded[0].type).toBe('start');
    expect(forwarded[1].type).toBe('next-steps');
  });
});
