import { existsSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import type { ErrorEvent, WarningEvent, XcodebuildEvent } from '../../types/xcodebuild-events.ts';
import { renderNextStepsSection } from '../responses/next-steps-renderer.ts';

function formatDetailTree(details: Array<{ label: string; value: string }>): string[] {
  return details.map((detail, index) => {
    const branch = index === details.length - 1 ? '└' : '├';
    return `  ${branch} ${detail.label}: ${detail.value}`;
  });
}

const FILE_DIAGNOSTIC_REGEX =
  /^(?<file>.+?):(?<line>\d+)(?::(?<column>\d+))?:\s*(?<kind>warning|error):\s*(?<message>.+)$/i;
const TOOLCHAIN_DIAGNOSTIC_REGEX = /^(warning|error):\s+.+$/i;
const LINKER_DIAGNOSTIC_REGEX = /^(ld|clang|swiftc):\s+(warning|error):\s+.+$/i;
const DIAGNOSTIC_PATH_IGNORE_PATTERNS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/build/**',
  '**/dist/**',
  '**/DerivedData/**',
];
const resolvedDiagnosticPathCache = new Map<string, string | null>();

export interface GroupedDiagnosticEntry {
  message: string;
  location?: string;
}

export interface DiagnosticFormattingOptions {
  baseDir?: string;
}

function resolveDiagnosticPathCandidate(
  filePath: string,
  options?: DiagnosticFormattingOptions,
): string {
  if (path.isAbsolute(filePath) || !options?.baseDir) {
    return filePath;
  }

  const directCandidate = path.resolve(options.baseDir, filePath);
  if (existsSync(directCandidate)) {
    return directCandidate;
  }

  if (filePath.includes('/') || filePath.includes(path.sep)) {
    return filePath;
  }

  const cacheKey = `${options.baseDir}::${filePath}`;
  const cached = resolvedDiagnosticPathCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ?? filePath;
  }

  const matches = globSync(`**/${filePath}`, {
    cwd: options.baseDir,
    nodir: true,
    ignore: DIAGNOSTIC_PATH_IGNORE_PATTERNS,
  });

  if (matches.length === 1) {
    const resolvedMatch = path.resolve(options.baseDir, matches[0]);
    resolvedDiagnosticPathCache.set(cacheKey, resolvedMatch);
    return resolvedMatch;
  }

  resolvedDiagnosticPathCache.set(cacheKey, null);
  return filePath;
}

function formatDiagnosticFilePath(filePath: string, options?: DiagnosticFormattingOptions): string {
  const candidate = resolveDiagnosticPathCandidate(filePath, options);
  if (!path.isAbsolute(candidate)) {
    return candidate;
  }

  const relative = path.relative(process.cwd(), candidate);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  return candidate;
}

function parseHumanDiagnostic(
  event: WarningEvent | ErrorEvent,
  kind: 'warning' | 'error',
  options?: DiagnosticFormattingOptions,
): GroupedDiagnosticEntry {
  const rawLine = event.rawLine.trim();
  const fileMatch = FILE_DIAGNOSTIC_REGEX.exec(rawLine);

  if (fileMatch?.groups) {
    const filePath = formatDiagnosticFilePath(fileMatch.groups.file, options);
    const line = fileMatch.groups.line;
    const column = fileMatch.groups.column;
    const message = fileMatch.groups.message;
    const location = column ? `${filePath}:${line}:${column}` : `${filePath}:${line}`;
    return { message: `${kind}: ${message}`, location };
  }

  if (TOOLCHAIN_DIAGNOSTIC_REGEX.test(rawLine) || LINKER_DIAGNOSTIC_REGEX.test(rawLine)) {
    return { message: `${kind}: ${event.message}` };
  }

  if (event.location) {
    return { message: `${event.location}: ${kind}: ${event.message}` };
  }

  return { message: `${kind}: ${event.message}` };
}

function isBuildRunStepNotice(
  event: Extract<XcodebuildEvent, { type: 'notice' }>,
): event is Extract<XcodebuildEvent, { type: 'notice' }> & {
  code: 'build-run-step';
  data: { step: string; status: string; appPath?: string };
} {
  return event.code === 'build-run-step' && typeof event.data === 'object' && event.data !== null;
}

function isBuildRunResultNotice(
  event: Extract<XcodebuildEvent, { type: 'notice' }>,
): event is Extract<XcodebuildEvent, { type: 'notice' }> & {
  code: 'build-run-result';
  data: { scheme: string; platform: string; target: string; appPath: string; launchState: string };
} {
  return event.code === 'build-run-result' && typeof event.data === 'object' && event.data !== null;
}

function formatBuildRunStepLabel(step: string): string {
  switch (step) {
    case 'resolve-app-path':
      return 'Resolving app path';
    case 'resolve-simulator':
      return 'Resolving simulator';
    case 'boot-simulator':
      return 'Booting simulator';
    case 'install-app':
      return 'Installing app';
    case 'extract-bundle-id':
      return 'Extracting bundle ID';
    case 'launch-app':
      return 'Launching app';
    default:
      return 'Running step';
  }
}

export function extractGroupedCompilerError(
  event: ErrorEvent,
  options?: DiagnosticFormattingOptions,
): GroupedDiagnosticEntry | null {
  const firstRawLine = event.rawLine.split('\n')[0].trim();
  const fileMatch = FILE_DIAGNOSTIC_REGEX.exec(firstRawLine);

  if (fileMatch?.groups) {
    const filePath = formatDiagnosticFilePath(fileMatch.groups.file, options);
    const line = fileMatch.groups.line;
    const column = fileMatch.groups.column;
    const location = column ? `${filePath}:${line}:${column}` : `${filePath}:${line}`;
    return { message: event.message, location };
  }

  if (event.location) {
    const locParts = event.location.match(/^(.+?)(:(?:\d+)(?::\d+)?)$/);
    if (locParts) {
      const filePath = formatDiagnosticFilePath(locParts[1], options);
      return { message: event.message, location: `${filePath}${locParts[2]}` };
    }
    return { message: event.message, location: event.location };
  }

  return null;
}

export function formatGroupedCompilerErrors(
  events: ErrorEvent[],
  options?: DiagnosticFormattingOptions,
): string {
  const hasFileLocated = events.some((e) => extractGroupedCompilerError(e, options) !== null);
  const heading = hasFileLocated
    ? `Compiler Errors (${events.length}):`
    : `Errors (${events.length}):`;
  const lines = [heading, ''];

  for (const event of events) {
    const fileDiagnostic = extractGroupedCompilerError(event, options);
    if (fileDiagnostic) {
      lines.push(`  ✗ ${fileDiagnostic.message}`);
      if (fileDiagnostic.location) {
        lines.push(`    ${fileDiagnostic.location}`);
      }
    } else {
      const messageLines = event.message.split('\n');
      lines.push(`  ✗ ${messageLines[0]}`);
      for (let i = 1; i < messageLines.length; i++) {
        lines.push(`    ${messageLines[i]}`);
      }
    }
    lines.push('');
  }

  while (lines.at(-1) === '') {
    lines.pop();
  }

  return lines.join('\n');
}

export function formatStartEvent(event: Extract<XcodebuildEvent, { type: 'start' }>): string {
  return event.message;
}

export function formatStatusEvent(event: Extract<XcodebuildEvent, { type: 'status' }>): string {
  switch (event.stage) {
    case 'RESOLVING_PACKAGES':
      return '› Resolving packages';
    case 'COMPILING':
      return '› Compiling';
    case 'LINKING':
      return '› Linking';
    case 'PREPARING_TESTS':
      return '› Preparing tests';
    case 'RUN_TESTS':
      return '› Running tests';
    case 'ARCHIVING':
      return '› Archiving';
    case 'COMPLETED':
      return event.message;
  }
}

export function formatTransientStatusEvent(
  event: Extract<XcodebuildEvent, { type: 'status' }>,
): string {
  switch (event.stage) {
    case 'RESOLVING_PACKAGES':
      return 'Resolving packages...';
    case 'COMPILING':
      return 'Compiling...';
    case 'LINKING':
      return 'Linking...';
    case 'PREPARING_TESTS':
      return 'Preparing tests...';
    case 'RUN_TESTS':
      return 'Running tests...';
    case 'ARCHIVING':
      return 'Archiving...';
    case 'COMPLETED':
      return event.message;
  }
}

export function formatHumanWarningEvent(
  event: Extract<XcodebuildEvent, { type: 'warning' }>,
  options?: DiagnosticFormattingOptions,
): string {
  const diagnostic = parseHumanDiagnostic(event, 'warning', options);
  const lines = [`  \u{26A0} ${event.message}`];
  if (diagnostic.location) {
    lines.push(`    ${diagnostic.location}`);
  }
  return lines.join('\n');
}

export function formatGroupedWarnings(
  events: Extract<XcodebuildEvent, { type: 'warning' }>[],
  options?: DiagnosticFormattingOptions,
): string {
  const heading = `Warnings (${events.length}):`;
  const lines = [heading, ''];

  for (const event of events) {
    const diagnostic = parseHumanDiagnostic(event, 'warning', options);
    lines.push(`  \u{26A0} ${event.message}`);
    if (diagnostic.location) {
      lines.push(`    ${diagnostic.location}`);
    }
    lines.push('');
  }

  while (lines.at(-1) === '') {
    lines.pop();
  }

  return lines.join('\n');
}

export function formatHumanErrorEvent(
  event: Extract<XcodebuildEvent, { type: 'error' }>,
  options?: DiagnosticFormattingOptions,
): string {
  const diagnostic = parseHumanDiagnostic(event, 'error', options);
  return diagnostic.location
    ? [diagnostic.message, `  ${diagnostic.location}`].join('\n')
    : diagnostic.message;
}

export function formatNoticeEvent(event: Extract<XcodebuildEvent, { type: 'notice' }>): string {
  if (isBuildRunStepNotice(event)) {
    const stepLabel = formatBuildRunStepLabel(event.data.step);
    return event.data.status === 'succeeded' ? `✓ ${stepLabel}` : `› ${stepLabel}`;
  }

  if (isBuildRunResultNotice(event)) {
    const details = [{ label: 'App Path', value: event.data.appPath }];

    if ('bundleId' in event.data && typeof event.data.bundleId === 'string') {
      details.push({ label: 'Bundle ID', value: event.data.bundleId });
    }

    if ('appId' in event.data && typeof event.data.appId === 'string') {
      details.push({ label: 'App ID', value: event.data.appId });
    }

    if ('processId' in event.data && typeof event.data.processId === 'number') {
      details.push({ label: 'Process ID', value: String(event.data.processId) });
    }

    if (event.data.launchState !== 'requested') {
      details.push({ label: 'Launch', value: 'Running' });
    }

    return ['✅ Build & Run complete', '', ...formatDetailTree(details)].join('\n');
  }

  switch (event.level) {
    case 'success':
      return `\u{2705} ${event.message}`;
    case 'warning':
      return `\u{26A0}\u{FE0F} ${event.message}`;
    default:
      return `\u{2139}\u{FE0F} ${event.message}`;
  }
}

export function formatTransientNoticeEvent(
  event: Extract<XcodebuildEvent, { type: 'notice' }>,
): string | null {
  if (!isBuildRunStepNotice(event) || event.data.status !== 'started') {
    return null;
  }

  const stepLabel = formatBuildRunStepLabel(event.data.step);
  return `${stepLabel}...`;
}

export function formatTestFailureEvent(
  event: Extract<XcodebuildEvent, { type: 'test-failure' }>,
  options?: DiagnosticFormattingOptions,
): string {
  const parts: string[] = [];
  if (event.suite) {
    parts.push(event.suite);
  }
  if (event.test) {
    parts.push(event.test);
  }
  const testPath = parts.length > 0 ? `${parts.join('/')}: ` : '';
  const lines = [`  \u{2717} ${testPath}${event.message}`];
  if (event.location) {
    const locParts = event.location.match(/^(.+?)(:(?:\d+)(?::\d+)?)$/);
    if (locParts) {
      const formattedPath = formatDiagnosticFilePath(locParts[1], options);
      lines.push(`    ${formattedPath}${locParts[2]}`);
    } else {
      lines.push(`    ${event.location}`);
    }
  }
  return lines.join('\n');
}

export function formatSummaryEvent(event: Extract<XcodebuildEvent, { type: 'summary' }>): string {
  const op = event.operation[0] + event.operation.slice(1).toLowerCase();
  const succeeded = event.status === 'SUCCEEDED';
  const statusEmoji = succeeded ? '\u{2705}' : '\u{274C}';
  const statusWord = succeeded ? 'succeeded' : 'failed';

  const details: string[] = [];

  if (event.totalTests !== undefined) {
    details.push(`Total: ${event.totalTests}`);
    if (event.passedTests !== undefined) {
      details.push(`Passed: ${event.passedTests}`);
    }
    if (event.failedTests !== undefined && event.failedTests > 0) {
      details.push(`Failed: ${event.failedTests}`);
    }
    if (event.skippedTests !== undefined && event.skippedTests > 0) {
      details.push(`Skipped: ${event.skippedTests}`);
    }
  }

  if (event.durationMs !== undefined) {
    const seconds = (event.durationMs / 1000).toFixed(1);
    details.push(`\u{23F1}\u{FE0F} ${seconds}s`);
  }

  const detailsSuffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `${statusEmoji} ${op} ${statusWord}.${detailsSuffix}`;
}

export function formatTestDiscoveryEvent(
  event: Extract<XcodebuildEvent, { type: 'test-discovery' }>,
): string {
  const testList = event.tests.join(', ');
  const truncation = event.truncated ? ` (and more)` : '';
  return `Discovered ${event.total} test(s): ${testList}${truncation}`;
}

export function formatNextStepsEvent(
  event: Extract<XcodebuildEvent, { type: 'next-steps' }>,
  runtime: 'cli' | 'mcp',
): string {
  return renderNextStepsSection(event.steps, runtime);
}
