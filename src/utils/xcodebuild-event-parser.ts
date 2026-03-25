import type {
  XcodebuildOperation,
  PipelineEvent,
  XcodebuildStage,
} from '../types/pipeline-events.ts';
import {
  packageResolutionPatterns,
  compilePatterns,
  linkPatterns,
  parseTestCaseLine,
  parseTotalsLine,
  parseFailureDiagnostic,
  parseBuildErrorDiagnostic,
} from './xcodebuild-line-parsers.ts';

function resolveStageFromLine(line: string): XcodebuildStage | null {
  if (packageResolutionPatterns.some((pattern) => pattern.test(line))) {
    return 'RESOLVING_PACKAGES';
  }
  if (compilePatterns.some((pattern) => pattern.test(line))) {
    return 'COMPILING';
  }
  if (linkPatterns.some((pattern) => pattern.test(line))) {
    return 'LINKING';
  }
  if (/^Testing started$/u.test(line) || /^Test Suite .+ started/u.test(line)) {
    return 'RUN_TESTS';
  }
  return null;
}

const stageMessages: Record<XcodebuildStage, string> = {
  RESOLVING_PACKAGES: 'Resolving packages',
  COMPILING: 'Compiling',
  LINKING: 'Linking',
  PREPARING_TESTS: 'Preparing tests',
  RUN_TESTS: 'Running tests',
  ARCHIVING: 'Archiving',
  COMPLETED: 'Completed',
};

function parseWarningLine(line: string): { location?: string; message: string } | null {
  const locationMatch = line.match(/^(.*?):(\d+)(?::\d+)?:\s+warning:\s+(.+)$/u);
  if (locationMatch) {
    return {
      location: `${locationMatch[1]}:${locationMatch[2]}`,
      message: locationMatch[3],
    };
  }

  const prefixedMatch = line.match(/^(?:[\w-]+:\s+)?warning:\s+(.+)$/iu);
  if (prefixedMatch) {
    return { message: prefixedMatch[1] };
  }

  return null;
}

function now(): string {
  return new Date().toISOString();
}

export interface EventParserOptions {
  operation: XcodebuildOperation;
  onEvent: (event: PipelineEvent) => void;
}

export interface XcodebuildEventParser {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  flush(): void;
}

export function createXcodebuildEventParser(options: EventParserOptions): XcodebuildEventParser {
  const { operation, onEvent } = options;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  let pendingError: {
    message: string;
    location?: string;
    rawLines: string[];
    timestamp: string;
  } | null = null;

  function flushPendingError(): void {
    if (!pendingError) {
      return;
    }
    onEvent({
      type: 'compiler-error',
      timestamp: pendingError.timestamp,
      operation,
      message: pendingError.message,
      location: pendingError.location,
      rawLine: pendingError.rawLines.join('\n'),
    });
    pendingError = null;
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) {
      flushPendingError();
      return;
    }

    if (pendingError && /^\s/u.test(rawLine)) {
      pendingError.message += `\n${line}`;
      pendingError.rawLines.push(rawLine);
      return;
    }

    flushPendingError();

    const testCase = parseTestCaseLine(line);
    if (testCase) {
      completedCount += 1;
      if (testCase.status === 'failed') {
        failedCount += 1;
      }
      if (testCase.status === 'skipped') {
        skippedCount += 1;
      }

      if (operation === 'TEST') {
        onEvent({
          type: 'test-progress',
          timestamp: now(),
          operation: 'TEST',
          completed: completedCount,
          failed: failedCount,
          skipped: skippedCount,
        });
      }
      return;
    }

    const totals = parseTotalsLine(line);
    if (totals) {
      completedCount = totals.executed;
      failedCount = totals.failed;

      if (operation === 'TEST') {
        onEvent({
          type: 'test-progress',
          timestamp: now(),
          operation: 'TEST',
          completed: completedCount,
          failed: failedCount,
          skipped: skippedCount,
        });
      }
      return;
    }

    const failureDiag = parseFailureDiagnostic(line);
    if (failureDiag) {
      if (operation === 'TEST') {
        onEvent({
          type: 'test-failure',
          timestamp: now(),
          operation: 'TEST',
          suite: failureDiag.suiteName,
          test: failureDiag.testName,
          message: failureDiag.message,
          location: failureDiag.location,
        });
      }
      return;
    }

    const stage = resolveStageFromLine(line);
    if (stage) {
      onEvent({
        type: 'build-stage',
        timestamp: now(),
        operation,
        stage,
        message: stageMessages[stage],
      });
      return;
    }

    const buildError = parseBuildErrorDiagnostic(line);
    if (buildError) {
      pendingError = {
        message: buildError.message,
        location: buildError.location,
        rawLines: [line],
        timestamp: now(),
      };
      return;
    }

    const warning = parseWarningLine(line);
    if (warning) {
      onEvent({
        type: 'compiler-warning',
        timestamp: now(),
        operation,
        message: warning.message,
        location: warning.location,
        rawLine: line,
      });
      return;
    }

    if (/^Test Suite /u.test(line)) {
      return;
    }
  }

  function drainLines(buffer: string, chunk: string): string {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/u);
    const remainder = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
    return remainder;
  }

  return {
    onStdout(chunk: string): void {
      stdoutBuffer = drainLines(stdoutBuffer, chunk);
    },
    onStderr(chunk: string): void {
      stderrBuffer = drainLines(stderrBuffer, chunk);
    },
    flush(): void {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        processLine(stderrBuffer);
      }
      flushPendingError();
      stdoutBuffer = '';
      stderrBuffer = '';
    },
  };
}
