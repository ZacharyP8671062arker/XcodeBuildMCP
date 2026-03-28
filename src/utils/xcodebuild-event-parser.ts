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
import {
  parseXcodebuildSwiftTestingLine,
  parseSwiftTestingIssueLine,
  parseSwiftTestingResultLine,
  parseSwiftTestingRunSummary,
  parseSwiftTestingContinuationLine,
} from './swift-testing-line-parsers.ts';

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
  if (
    /^Testing started$/u.test(line) ||
    /^Test Suite .+ started/u.test(line) ||
    /^[◇] Test run started/u.test(line)
  ) {
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

const IGNORED_NOISE_PATTERNS = [
  /^Command line invocation:$/u,
  /^\s*\/Applications\/Xcode[^\s]+\/Contents\/Developer\/usr\/bin\/xcodebuild\b/u,
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+xcodebuild\[.+\]\s+Writing error result bundle to\s+/u,
  /^Build settings from command line:$/u,
  /^(?:COMPILER_INDEX_STORE_ENABLE|ONLY_ACTIVE_ARCH)\s*=\s*.+$/u,
  /^Resolve Package Graph$/u,
  /^Resolved source packages:$/u,
  /^\s*[A-Za-z0-9_.-]+:\s+.+$/u,
  /^--- xcodebuild: WARNING: Using the first of multiple matching destinations:$/u,
  /^\{\s*platform:.+\}$/u,
  /^(?:ComputePackagePrebuildTargetDependencyGraph|Prepare packages|CreateBuildRequest|SendProjectDescription|CreateBuildOperation|ComputeTargetDependencyGraph|GatherProvisioningInputs|CreateBuildDescription)$/u,
  /^Target '.+' in project '.+' \(no dependencies\)$/u,
  /^(?:Build description signature|Build description path):\s+.+$/u,
  /^(?:ExecuteExternalTool|ClangStatCache|CopySwiftLibs|builtin-infoPlistUtility|builtin-swiftStdLibTool)\b/u,
  /^cd\s+.+$/u,
  /^\*\* BUILD SUCCEEDED \*\*$/u,
];

function isIgnoredNoiseLine(line: string): boolean {
  return IGNORED_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function now(): string {
  return new Date().toISOString();
}

export interface EventParserOptions {
  operation: XcodebuildOperation;
  onEvent: (event: PipelineEvent) => void;
  onUnrecognizedLine?: (line: string) => void;
}

export interface XcodebuildEventParser {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  flush(): void;
  xcresultPath: string | null;
}

export function createXcodebuildEventParser(options: EventParserOptions): XcodebuildEventParser {
  const { operation, onEvent, onUnrecognizedLine } = options;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let detectedXcresultPath: string | null = null;

  let pendingError: {
    message: string;
    location?: string;
    rawLines: string[];
    timestamp: string;
  } | null = null;

  let pendingSwiftTestingIssue: {
    testName?: string;
    message: string;
    location?: string;
  } | null = null;

  function flushPendingSwiftTestingIssue(): void {
    if (!pendingSwiftTestingIssue) {
      return;
    }
    if (operation === 'TEST') {
      onEvent({
        type: 'test-failure',
        timestamp: now(),
        operation: 'TEST',
        test: pendingSwiftTestingIssue.testName,
        message: pendingSwiftTestingIssue.message,
        location: pendingSwiftTestingIssue.location,
      });
    }
    pendingSwiftTestingIssue = null;
  }

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
      flushPendingSwiftTestingIssue();
      flushPendingError();
      return;
    }

    // Swift Testing continuation line (↳) appends context to pending issue
    const stContinuation = parseSwiftTestingContinuationLine(line);
    if (stContinuation && pendingSwiftTestingIssue) {
      pendingSwiftTestingIssue.message += `\n${stContinuation}`;
      return;
    }

    flushPendingSwiftTestingIssue();

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

    // xcodebuild Swift Testing: Test case 'Suite/test()' passed on 'device' (0.000 seconds)
    const xcodebuildST = parseXcodebuildSwiftTestingLine(line);
    if (xcodebuildST) {
      completedCount += 1;
      if (xcodebuildST.status === 'failed') {
        failedCount += 1;
      }
      if (xcodebuildST.status === 'skipped') {
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

    // Swift Testing issue: ✘ Test "Name" recorded an issue at file:line:col: message
    const stIssue = parseSwiftTestingIssueLine(line);
    if (stIssue) {
      pendingSwiftTestingIssue = {
        testName: stIssue.testName,
        message: stIssue.message,
        location: stIssue.location,
      };
      return;
    }

    // Swift Testing result: ✔/✘ Test "Name" passed/failed after X seconds
    const stResult = parseSwiftTestingResultLine(line);
    if (stResult) {
      completedCount += 1;
      if (stResult.status === 'failed') {
        failedCount += 1;
      }
      if (stResult.status === 'skipped') {
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

    // Swift Testing run summary: ✔/✘ Test run with N tests...
    const stSummary = parseSwiftTestingRunSummary(line);
    if (stSummary) {
      completedCount = stSummary.executed;
      failedCount = stSummary.failed;
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

    if (isIgnoredNoiseLine(line)) {
      return;
    }

    // Capture xcresult path from xcodebuild output
    const xcresultMatch = line.match(/^\s*(\S+\.xcresult)\s*$/u);
    if (xcresultMatch) {
      detectedXcresultPath = xcresultMatch[1];
      return;
    }

    if (onUnrecognizedLine) {
      onUnrecognizedLine(line);
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
      flushPendingSwiftTestingIssue();
      flushPendingError();
      stdoutBuffer = '';
      stderrBuffer = '';
    },
    get xcresultPath(): string | null {
      return detectedXcresultPath;
    },
  };
}
