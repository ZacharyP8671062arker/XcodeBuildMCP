import type { ParsedTestCase, ParsedFailureDiagnostic, ParsedTotals } from './xcodebuild-line-parsers.ts';

/**
 * Parse a Swift Testing result line (passed/failed/skipped).
 *
 * Matches:
 *   ✔ Test "Name" passed after 0.001 seconds.
 *   ✘ Test "Name" failed after 0.001 seconds with 1 issue.
 *   ✘ Test "Name" failed after 0.001 seconds with 3 issues.
 *   ◇ Test "Name" skipped.
 */
export function parseSwiftTestingResultLine(line: string): ParsedTestCase | null {
  const passedMatch = line.match(
    /^[✔] Test "(.+)" passed after ([\d.]+) seconds\.?$/u,
  );
  if (passedMatch) {
    const [, name, duration] = passedMatch;
    return {
      status: 'passed',
      rawName: name,
      testName: name,
      durationText: `${duration}s`,
    };
  }

  const failedMatch = line.match(
    /^[✘] Test "(.+)" failed after ([\d.]+) seconds/u,
  );
  if (failedMatch) {
    const [, name, duration] = failedMatch;
    return {
      status: 'failed',
      rawName: name,
      testName: name,
      durationText: `${duration}s`,
    };
  }

  const skippedMatch = line.match(/^[◇] Test "(.+)" skipped/u);
  if (skippedMatch) {
    return {
      status: 'skipped',
      rawName: skippedMatch[1],
      testName: skippedMatch[1],
    };
  }

  return null;
}

/**
 * Parse a Swift Testing issue line.
 *
 * Matches:
 *   ✘ Test "Name" recorded an issue at File.swift:48:5: Expectation failed: ...
 *   ✘ Test "Name" recorded an issue: message
 */
export function parseSwiftTestingIssueLine(line: string): ParsedFailureDiagnostic | null {
  const locationMatch = line.match(
    /^[✘] Test "(.+)" recorded an issue at (.+?):(\d+):\d+: (.+)$/u,
  );
  if (locationMatch) {
    const [, testName, filePath, lineNumber, message] = locationMatch;
    return {
      rawTestName: testName,
      testName,
      location: `${filePath}:${lineNumber}`,
      message,
    };
  }

  const simpleMatch = line.match(
    /^[✘] Test "(.+)" recorded an issue: (.+)$/u,
  );
  if (simpleMatch) {
    const [, testName, message] = simpleMatch;
    return {
      rawTestName: testName,
      testName,
      message,
    };
  }

  return null;
}

/**
 * Parse a Swift Testing run summary line.
 *
 * Matches:
 *   ✔ Test run with 6 tests in 2 suites passed after 0.001 seconds.
 *   ✘ Test run with 6 tests in 0 suites failed after 0.001 seconds with 1 issue.
 */
export function parseSwiftTestingRunSummary(line: string): ParsedTotals | null {
  const match = line.match(
    /^[✔✘] Test run with (\d+) tests? in \d+ suites? (?:passed|failed) after ([\d.]+) seconds/u,
  );
  if (!match) {
    return null;
  }

  const total = Number(match[1]);
  const durationText = `${match[2]}s`;

  const issueMatch = line.match(/with (\d+) issues?/u);
  const failed = issueMatch ? Number(issueMatch[1]) : 0;

  return { executed: total, failed, durationText };
}

/**
 * Parse a Swift Testing continuation line (additional context for an issue).
 *
 * Matches:
 *   ↳ This test should fail...
 */
export function parseSwiftTestingContinuationLine(line: string): string | null {
  const match = line.match(/^↳ (.+)$/u);
  return match ? match[1] : null;
}

/**
 * Parse xcodebuild's Swift Testing format.
 *
 * Matches:
 *   Test case 'Suite/testName()' passed on 'My Mac - App (12345)' (0.001 seconds)
 *   Test case 'Suite/testName()' failed on 'My Mac - App (12345)' (0.001 seconds)
 */
export function parseXcodebuildSwiftTestingLine(line: string): ParsedTestCase | null {
  const match = line.match(
    /^Test case '(.+)' (passed|failed|skipped) on '.+' \(([^)]+) seconds?\)$/u,
  );
  if (!match) {
    return null;
  }
  const [, rawName, status, duration] = match;

  const slashIndex = rawName.lastIndexOf('/');
  const suiteName = slashIndex > 0 ? rawName.slice(0, slashIndex) : undefined;
  const testName = slashIndex > 0 ? rawName.slice(slashIndex + 1) : rawName;

  return {
    status: status as 'passed' | 'failed' | 'skipped',
    rawName,
    suiteName,
    testName,
    durationText: `${duration}s`,
  };
}
