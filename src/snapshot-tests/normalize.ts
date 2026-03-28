import os from 'node:os';
import path from 'node:path';

const ANSI_REGEX = /\x1B\[[0-9;]*[mK]/g;
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;
const UUID_REGEX = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const DURATION_REGEX = /\d+\.\d+s\b/g;
const PID_NUMBER_REGEX = /pid:\s*\d+/gi;
const PID_JSON_REGEX = /"pid"\s*:\s*\d+/g;
const PROCESS_ID_REGEX = /Process ID: \d+/g;
const PROCESS_INLINE_PID_REGEX = /process \d+/g;
const THREAD_ID_REGEX = /Thread \d{5,}/g;
const HEX_ADDRESS_REGEX = /0x[0-9a-fA-F]{8,}/g;

const LLDB_FRAME_OFFSET_REGEX = /(`[^`]+):(\d+)$/gm;
const DERIVED_DATA_HASH_REGEX = /(DerivedData\/[A-Za-z0-9_]+)-[a-z]{28}\b/g;
const PROGRESS_LINE_REGEX = /^›.*\n*/gm;
const WARNINGS_BLOCK_REGEX = /Warnings \(\d+\):\n(?:\n? *⚠[^\n]*\n?)*/g;
const TEST_DISCOVERY_REGEX =
  /Resolved to \d+ test\(s\):\n(?:\s*-\s+[^\n]+\n)*(?:\s*\.\.\. and \d+ more\n)?/g;
const TEST_FAILURE_BLOCK_REGEX = /^ {2}✗ [^\n]+\n(?: {4}[^\n]+\n)*/gm;
const XCODE_INFRA_ERRORS_REGEX =
  /Compiler Errors \(\d+\):\n(?:\n? *✗ (?:unable to rename temporary|failed to emit precompiled|accessing build database)[^\n]*\n?(?:\n? {4}[^\n]*\n?)*)*/g;
const SPM_STEP_LINE_REGEX = /^\[\d+\/\d+\] .+\n?/gm;
const SPM_PLANNING_LINE_REGEX = /^Building for (?:debugging|release)\.\.\.\n?/gm;
const LOCAL_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/g;
const XCTEST_PARENS_DURATION_REGEX = /\(\d+\.\d+\) seconds/g;
const SWIFT_TESTING_DURATION_REGEX = /after \d+\.\d+ seconds/g;
const TEST_SUMMARY_COUNTS_REGEX =
  /\(Total: \d+(?:, Passed: \d+)?(?:, Failed: \d+)?(?:, Skipped: \d+)?, /g;
const COVERAGE_CALL_COUNT_REGEX = /called \d+x\)/g;
const RESULT_BUNDLE_LINE_REGEX = /\S+\[\d+:\d+\] Writing error result bundle to \S+/g;
const TRAILING_WHITESPACE_REGEX = /[ \t]+$/gm;

function sortLinesInBlock(text: string, marker: RegExp): string {
  const lines = text.split('\n');
  const blocks: { start: number; end: number }[] = [];
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (marker.test(lines[i]!)) {
      if (blockStart === -1) blockStart = i;
    } else if (blockStart !== -1) {
      blocks.push({ start: blockStart, end: i });
      blockStart = -1;
    }
  }
  if (blockStart !== -1) blocks.push({ start: blockStart, end: lines.length });
  for (const block of blocks) {
    const slice = lines.slice(block.start, block.end);
    slice.sort();
    lines.splice(block.start, block.end - block.start, ...slice);
  }
  return lines.join('\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSnapshotOutput(text: string): string {
  let normalized = text;

  normalized = normalized.replace(ANSI_REGEX, '');

  const projectRoot = path.resolve(process.cwd());
  normalized = normalized.replace(new RegExp(escapeRegex(projectRoot), 'g'), '<ROOT>');

  const home = os.homedir();
  normalized = normalized.replace(new RegExp(escapeRegex(home), 'g'), '<HOME>');

  const tmpDir = os.tmpdir();
  normalized = normalized.replace(
    new RegExp(escapeRegex(tmpDir) + '/[A-Za-z0-9._-]+/', 'g'),
    '<TMPDIR>/',
  );

  normalized = normalized.replace(DERIVED_DATA_HASH_REGEX, '$1-<HASH>');
  normalized = normalized.replace(ISO_TIMESTAMP_REGEX, '<TIMESTAMP>');
  normalized = normalized.replace(UUID_REGEX, '<UUID>');
  normalized = normalized.replace(/Device: .+ \(<UUID>\)/g, 'Device: <DEVICE> (<UUID>)');
  normalized = normalized.replace(DURATION_REGEX, '<DURATION>');
  normalized = normalized.replace(PID_NUMBER_REGEX, (match) => match.replace(/\d+/, '<PID>'));
  normalized = normalized.replace(PID_JSON_REGEX, '"pid" : <PID>');
  normalized = normalized.replace(PROCESS_ID_REGEX, 'Process ID: <PID>');
  normalized = normalized.replace(PROCESS_INLINE_PID_REGEX, 'process <PID>');
  normalized = normalized.replace(THREAD_ID_REGEX, 'Thread <THREAD_ID>');
  normalized = normalized.replace(HEX_ADDRESS_REGEX, '<ADDR>');
  normalized = normalized.replace(LLDB_FRAME_OFFSET_REGEX, '$1:<OFFSET>');
  normalized = normalized.replace(RESULT_BUNDLE_LINE_REGEX, '<RESULT_BUNDLE_ERROR>');
  normalized = normalized.replace(PROGRESS_LINE_REGEX, '');
  normalized = normalized.replace(WARNINGS_BLOCK_REGEX, '');
  normalized = normalized.replace(XCODE_INFRA_ERRORS_REGEX, '');

  normalized = normalized.replace(SPM_STEP_LINE_REGEX, '');
  normalized = normalized.replace(SPM_PLANNING_LINE_REGEX, '');
  normalized = normalized.replace(LOCAL_TIMESTAMP_REGEX, '<TIMESTAMP>');
  normalized = normalized.replace(XCTEST_PARENS_DURATION_REGEX, '(<DURATION>) seconds');
  normalized = normalized.replace(SWIFT_TESTING_DURATION_REGEX, 'after <DURATION> seconds');
  normalized = normalized.replace(TEST_SUMMARY_COUNTS_REGEX, '(<TEST_COUNTS>, ');

  normalized = normalized.replace(COVERAGE_CALL_COUNT_REGEX, 'called <N>x)');

  normalized = normalized.replace(/"(?:x|y|width|height)"\s*:\s*(\d+\.\d{2,})/g, (match, num) => {
    return match.replace(num, parseFloat(num).toFixed(1));
  });

  normalized = sortLinesInBlock(normalized, /^[◇✔✘] Test "/);

  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(TRAILING_WHITESPACE_REGEX, '');
  normalized = normalized.replace(/\n*$/, '\n');

  return normalized;
}
