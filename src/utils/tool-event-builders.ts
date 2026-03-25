import type {
  HeaderEvent,
  SectionEvent,
  StatusLineEvent,
  FileRefEvent,
  TableEvent,
  DetailTreeEvent,
  SummaryEvent,
} from '../types/pipeline-events.ts';

function now(): string {
  return new Date().toISOString();
}

export function header(
  operation: string,
  params?: Array<{ label: string; value: string }>,
): HeaderEvent {
  return {
    type: 'header',
    timestamp: now(),
    operation,
    params: params ?? [],
  };
}

export function section(
  title: string,
  lines: string[],
  opts?: { icon?: SectionEvent['icon'] },
): SectionEvent {
  return {
    type: 'section',
    timestamp: now(),
    title,
    icon: opts?.icon,
    lines,
  };
}

export function statusLine(level: StatusLineEvent['level'], message: string): StatusLineEvent {
  return {
    type: 'status-line',
    timestamp: now(),
    level,
    message,
  };
}

export function fileRef(path: string, label?: string): FileRefEvent {
  return {
    type: 'file-ref',
    timestamp: now(),
    label,
    path,
  };
}

export function table(
  columns: string[],
  rows: Array<Record<string, string>>,
  heading?: string,
): TableEvent {
  return {
    type: 'table',
    timestamp: now(),
    heading,
    columns,
    rows,
  };
}

export function detailTree(items: Array<{ label: string; value: string }>): DetailTreeEvent {
  return {
    type: 'detail-tree',
    timestamp: now(),
    items,
  };
}

export function summary(
  status: 'SUCCEEDED' | 'FAILED',
  opts?: {
    operation?: string;
    durationMs?: number;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    skippedTests?: number;
  },
): SummaryEvent {
  return {
    type: 'summary',
    timestamp: now(),
    status,
    operation: opts?.operation,
    durationMs: opts?.durationMs,
    totalTests: opts?.totalTests,
    passedTests: opts?.passedTests,
    failedTests: opts?.failedTests,
    skippedTests: opts?.skippedTests,
  };
}
