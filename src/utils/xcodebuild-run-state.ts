import type {
  XcodebuildOperation,
  XcodebuildStage,
  XcodebuildEvent,
  StatusEvent,
  WarningEvent,
  ErrorEvent,
  TestFailureEvent,
} from '../types/xcodebuild-events.ts';
import { STAGE_RANK } from '../types/xcodebuild-events.ts';

export interface XcodebuildRunState {
  operation: XcodebuildOperation;
  currentStage: XcodebuildStage | null;
  milestones: StatusEvent[];
  warnings: WarningEvent[];
  errors: ErrorEvent[];
  testFailures: TestFailureEvent[];
  completedTests: number;
  failedTests: number;
  skippedTests: number;
  finalStatus: 'SUCCEEDED' | 'FAILED' | null;
  wallClockDurationMs: number | null;
  events: XcodebuildEvent[];
}

export interface RunStateOptions {
  operation: XcodebuildOperation;
  minimumStage?: XcodebuildStage;
  onEvent?: (event: XcodebuildEvent) => void;
}

function normalizeDiagnosticKey(location: string | undefined, message: string): string {
  return `${location ?? ''}|${message}`.trim().toLowerCase();
}

export interface FinalizeOptions {
  emitSummary?: boolean;
  tailEvents?: XcodebuildEvent[];
}

export interface XcodebuildRunStateHandle {
  push(event: XcodebuildEvent): void;
  finalize(succeeded: boolean, durationMs?: number, options?: FinalizeOptions): XcodebuildRunState;
  snapshot(): Readonly<XcodebuildRunState>;
  highestStageRank(): number;
}

export function createXcodebuildRunState(options: RunStateOptions): XcodebuildRunStateHandle {
  const { operation, onEvent } = options;

  const state: XcodebuildRunState = {
    operation,
    currentStage: null,
    milestones: [],
    warnings: [],
    errors: [],
    testFailures: [],
    completedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    finalStatus: null,
    wallClockDurationMs: null,
    events: [],
  };

  let highestRank = options.minimumStage !== undefined ? STAGE_RANK[options.minimumStage] : -1;
  const seenDiagnostics = new Set<string>();

  function accept(event: XcodebuildEvent): void {
    state.events.push(event);
    onEvent?.(event);
  }

  return {
    push(event: XcodebuildEvent): void {
      switch (event.type) {
        case 'status': {
          const rank = STAGE_RANK[event.stage];
          if (rank <= highestRank) {
            return;
          }
          highestRank = rank;
          state.currentStage = event.stage;
          state.milestones.push(event);
          accept(event);
          break;
        }

        case 'warning': {
          const key = normalizeDiagnosticKey(event.location, event.message);
          if (seenDiagnostics.has(key)) {
            return;
          }
          seenDiagnostics.add(key);
          state.warnings.push(event);
          accept(event);
          break;
        }

        case 'error': {
          const key = normalizeDiagnosticKey(event.location, event.message);
          if (seenDiagnostics.has(key)) {
            return;
          }
          seenDiagnostics.add(key);
          state.errors.push(event);
          accept(event);
          break;
        }

        case 'test-failure': {
          const key = normalizeDiagnosticKey(event.location, event.message);
          if (seenDiagnostics.has(key)) {
            return;
          }
          seenDiagnostics.add(key);
          state.testFailures.push(event);
          accept(event);
          break;
        }

        case 'test-progress': {
          state.completedTests = event.completed;
          state.failedTests = event.failed;
          state.skippedTests = event.skipped;

          // Ensure RUN_TESTS milestone when we see test progress
          if (highestRank < STAGE_RANK.RUN_TESTS) {
            const runTestsEvent: StatusEvent = {
              type: 'status',
              timestamp: event.timestamp,
              operation: 'TEST',
              stage: 'RUN_TESTS',
              message: 'Running tests',
            };
            highestRank = STAGE_RANK.RUN_TESTS;
            state.currentStage = 'RUN_TESTS';
            state.milestones.push(runTestsEvent);
            accept(runTestsEvent);
          }

          accept(event);
          break;
        }

        case 'start':
        case 'notice':
        case 'test-discovery':
        case 'summary':
        case 'next-steps': {
          accept(event);
          break;
        }
      }
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      options?: FinalizeOptions,
    ): XcodebuildRunState {
      state.finalStatus = succeeded ? 'SUCCEEDED' : 'FAILED';
      state.wallClockDurationMs = durationMs ?? null;

      if (options?.emitSummary !== false) {
        const summaryEvent: XcodebuildEvent = {
          type: 'summary',
          timestamp: new Date().toISOString(),
          operation,
          status: state.finalStatus,
          ...(operation === 'TEST'
            ? {
                totalTests: state.completedTests,
                passedTests: state.completedTests - state.failedTests - state.skippedTests,
                failedTests: state.failedTests,
                skippedTests: state.skippedTests,
              }
            : {}),
          durationMs,
        };

        accept(summaryEvent);
      }

      for (const tailEvent of options?.tailEvents ?? []) {
        accept(tailEvent);
      }

      return { ...state };
    },

    snapshot(): Readonly<XcodebuildRunState> {
      return { ...state };
    },

    highestStageRank(): number {
      return highestRank;
    },
  };
}
