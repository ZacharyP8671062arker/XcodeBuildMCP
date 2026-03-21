export const packageResolutionPatterns = [
  /^Resolve Package Graph$/u,
  /^Resolved source packages:/u,
  /^Fetching from /u,
  /^Checking out /u,
  /^Creating working copy /u,
  /^Updating https?:\/\//u,
];

export const compilePatterns = [
  /^CompileSwift /u,
  /^SwiftCompile /u,
  /^CompileC /u,
  /^ProcessInfoPlistFile /u,
  /^PhaseScriptExecution /u,
  /^CodeSign /u,
  /^CompileAssetCatalog /u,
  /^ProcessProductPackaging /u,
];

export const linkPatterns = [/^Ld /u];

export interface ParsedTestCase {
  status: 'passed' | 'failed' | 'skipped';
  rawName: string;
  suiteName?: string;
  testName: string;
  durationText?: string;
}

export interface ParsedTotals {
  executed: number;
  failed: number;
  durationText?: string;
}

export interface ParsedFailureDiagnostic {
  rawTestName?: string;
  suiteName?: string;
  testName?: string;
  location?: string;
  message: string;
}

export interface ParsedBuildError {
  location?: string;
  message: string;
  renderedLine: string;
}

export function parseRawTestName(rawName: string): { suiteName?: string; testName: string } {
  const objcMatch = rawName.match(/^-\[(.+?)\s+(.+)\]$/u);
  if (objcMatch) {
    return { suiteName: objcMatch[1], testName: objcMatch[2] };
  }

  const slashParts = rawName.split('/').filter(Boolean);
  if (slashParts.length >= 3) {
    return { suiteName: `${slashParts[0]}/${slashParts[1]}`, testName: slashParts[2] };
  }

  const dotIndex = rawName.lastIndexOf('.');
  if (dotIndex > 0) {
    return { suiteName: rawName.slice(0, dotIndex), testName: rawName.slice(dotIndex + 1) };
  }

  return { testName: rawName };
}

export function parseTestCaseLine(line: string): ParsedTestCase | null {
  const match = line.match(/^Test Case '(.+)' (passed|failed|skipped) \(([^)]+)\)/u);
  if (!match) {
    return null;
  }
  const [, rawName, status, durationText] = match;
  const { suiteName, testName } = parseRawTestName(rawName);
  return {
    status: status as 'passed' | 'failed' | 'skipped',
    rawName,
    suiteName,
    testName,
    durationText,
  };
}

export function parseTotalsLine(line: string): ParsedTotals | null {
  const match = line.match(
    /^Executed (\d+) tests?, with (\d+) failures?(?: \(\d+ unexpected\))? in (.+)$/u,
  );
  if (!match) {
    return null;
  }
  return { executed: Number(match[1]), failed: Number(match[2]), durationText: match[3] };
}

export function parseFailureDiagnostic(line: string): ParsedFailureDiagnostic | null {
  const match = line.match(/^(.*?):(\d+): error: -\[(.+?)\s+(.+?)\] : (.+)$/u);
  if (!match) {
    return null;
  }
  const [, filePath, lineNumber, suiteName, testName, message] = match;
  return {
    rawTestName: `-[${suiteName} ${testName}]`,
    suiteName,
    testName,
    location: `${filePath}:${lineNumber}`,
    message,
  };
}

export function parseBuildErrorDiagnostic(line: string): ParsedBuildError | null {
  const locationMatch = line.match(/^(.*?):(\d+)(?::\d+)?: (?:fatal error|error): (.+)$/u);
  if (locationMatch) {
    const [, filePath, lineNumber, message] = locationMatch;
    return {
      location: `${filePath}:${lineNumber}`,
      message,
      renderedLine: line,
    };
  }

  const rawMatch = line.match(/^(?:[\w-]+:\s+)?(?:fatal error|error): (.+)$/u);
  if (!rawMatch) {
    return null;
  }
  const [, message] = rawMatch;
  return { message, renderedLine: line };
}
