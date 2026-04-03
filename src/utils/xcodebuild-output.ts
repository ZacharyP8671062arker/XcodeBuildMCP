import type { NextStep, ToolResponse, ToolResponseContent } from '../types/common.ts';
import type {
  BuildRunResultNoticeData,
  BuildRunStepNoticeData,
  NoticeCode,
  NoticeLevel,
  PipelineEvent,
  XcodebuildOperation,
} from '../types/pipeline-events.ts';
import type { StartedPipeline } from './xcodebuild-pipeline.ts';
import { displayPath } from './build-preflight.ts';

interface PipelineOutputMetaExtras {
  [key: string]: unknown;
}

type XcodebuildStreamMode = 'complete' | 'legacy';

interface PendingXcodebuildState {
  kind: 'pending-xcodebuild';
  started: StartedPipeline;
  emitSummary: boolean;
  extras: PipelineOutputMetaExtras;
  fallbackContent: ToolResponseContent[];
  tailEvents: PipelineEvent[];
  errorFallbackPolicy: ErrorFallbackPolicy;
  includeBuildLogFileRef: boolean;
  includeParserDebugFileRef: boolean;
}

function createPipelineOutputMeta(
  events: PipelineEvent[],
  streamedContentCount: number,
  extras: PipelineOutputMetaExtras = {},
  streamMode: XcodebuildStreamMode = 'legacy',
): Record<string, unknown> {
  return {
    ...extras,
    events,
    streamedContentCount,
    streamedEventCount: events.length,
    xcodebuildStreamMode: streamMode,
  };
}

function createStructuredErrorEvent(
  operation: XcodebuildOperation,
  message: string,
): PipelineEvent {
  return {
    type: 'compiler-error',
    timestamp: new Date().toISOString(),
    operation,
    message,
    rawLine: message,
  };
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

export function createNoticeEvent(
  operation: XcodebuildOperation,
  message: string,
  level: NoticeLevel = 'info',
  options: {
    code?: NoticeCode;
    data?:
      | Record<string, string | number | boolean>
      | BuildRunStepNoticeData
      | BuildRunResultNoticeData;
  } = {},
): PipelineEvent {
  if (options.code === 'build-run-step' && options.data && typeof options.data === 'object') {
    const data = options.data as BuildRunStepNoticeData;
    const stepLabel = formatBuildRunStepLabel(data.step);
    return {
      type: 'status-line',
      timestamp: new Date().toISOString(),
      level: data.status === 'succeeded' ? 'success' : 'info',
      message: stepLabel,
    };
  }

  const statusLevel = level === 'success' || level === 'warning' ? level : 'info';

  return {
    type: 'status-line',
    timestamp: new Date().toISOString(),
    level: statusLevel,
    message,
  };
}

export function createBuildRunResultEvents(data: BuildRunResultNoticeData): PipelineEvent[] {
  const events: PipelineEvent[] = [];

  events.push({
    type: 'status-line',
    timestamp: new Date().toISOString(),
    level: 'success',
    message: 'Build & Run complete',
  });

  const items: Array<{ label: string; value: string }> = [
    { label: 'App Path', value: data.appPath },
  ];

  if (data.bundleId) {
    items.push({ label: 'Bundle ID', value: data.bundleId });
  }

  if (data.appId) {
    items.push({ label: 'App ID', value: data.appId });
  }

  if (data.processId !== undefined) {
    items.push({ label: 'Process ID', value: String(data.processId) });
  }

  if (data.buildLogPath) {
    items.push({ label: 'Build Logs', value: displayPath(data.buildLogPath) });
  }

  if (data.runtimeLogPath) {
    items.push({ label: 'Runtime Logs', value: displayPath(data.runtimeLogPath) });
  }

  if (data.osLogPath) {
    items.push({ label: 'OSLog', value: displayPath(data.osLogPath) });
  }

  if (data.launchState !== 'requested') {
    items.push({ label: 'Launch', value: 'Running' });
  }

  events.push({
    type: 'detail-tree',
    timestamp: new Date().toISOString(),
    items,
  });

  return events;
}

function createNextStepsEvent(steps: NextStep[]): PipelineEvent | null {
  if (steps.length === 0) {
    return null;
  }

  return {
    type: 'next-steps',
    timestamp: new Date().toISOString(),
    steps,
  };
}

export function emitPipelineNotice(
  started: StartedPipeline,
  operation: XcodebuildOperation,
  message: string,
  level: NoticeLevel = 'info',
  options: {
    code?: NoticeCode;
    data?:
      | Record<string, string | number | boolean>
      | BuildRunStepNoticeData
      | BuildRunResultNoticeData;
  } = {},
): void {
  if (options.code === 'build-run-result' && options.data && typeof options.data === 'object') {
    const resultEvents = createBuildRunResultEvents(options.data as BuildRunResultNoticeData);
    for (const event of resultEvents) {
      started.pipeline.emitEvent(event);
    }
    return;
  }
  started.pipeline.emitEvent(createNoticeEvent(operation, message, level, options));
}

export function emitPipelineError(
  started: StartedPipeline,
  operation: XcodebuildOperation,
  message: string,
): void {
  started.pipeline.emitEvent(createStructuredErrorEvent(operation, message));
}

type ErrorFallbackPolicy = 'always' | 'if-no-structured-diagnostics';

interface PendingXcodebuildResponseOptions {
  extras?: PipelineOutputMetaExtras;
  emitSummary?: boolean;
  tailEvents?: PipelineEvent[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
  includeBuildLogFileRef?: boolean;
  includeParserDebugFileRef?: boolean;
}

export function createPendingXcodebuildResponse(
  started: StartedPipeline,
  response: ToolResponse,
  options: PendingXcodebuildResponseOptions = {},
): ToolResponse {
  return {
    ...response,
    content: [],
    _meta: {
      ...(response._meta ?? {}),
      pendingXcodebuild: {
        kind: 'pending-xcodebuild',
        started,
        emitSummary: options.emitSummary ?? true,
        extras: options.extras ?? {},
        fallbackContent: response.isError ? response.content : [],
        tailEvents: options.tailEvents ?? [],
        errorFallbackPolicy: options.errorFallbackPolicy ?? 'always',
        includeBuildLogFileRef: options.includeBuildLogFileRef ?? true,
        includeParserDebugFileRef: options.includeParserDebugFileRef ?? false,
      } satisfies PendingXcodebuildState,
    },
  };
}

export function isPendingXcodebuildResponse(response: ToolResponse): boolean {
  const pending = response._meta?.pendingXcodebuild;
  return (
    typeof pending === 'object' &&
    pending !== null &&
    (pending as PendingXcodebuildState).kind === 'pending-xcodebuild'
  );
}

function getPendingXcodebuildState(response: ToolResponse): PendingXcodebuildState {
  if (!isPendingXcodebuildResponse(response)) {
    throw new Error('Response is not a pending xcodebuild response');
  }

  return response._meta?.pendingXcodebuild as PendingXcodebuildState;
}

export function finalizePendingXcodebuildResponse(
  response: ToolResponse,
  options: { nextSteps?: NextStep[] } = {},
): ToolResponse {
  const pending = getPendingXcodebuildState(response);
  const durationMs = Math.max(0, Date.now() - pending.started.startedAt);
  const nextStepsEvent =
    !response.isError && options.nextSteps ? createNextStepsEvent(options.nextSteps) : null;
  const tailEvents = [...pending.tailEvents];
  if (nextStepsEvent) {
    tailEvents.push(nextStepsEvent);
  }
  const pipelineResult = pending.started.pipeline.finalize(!response.isError, durationMs, {
    emitSummary: pending.emitSummary,
    tailEvents,
    includeBuildLogFileRef: pending.includeBuildLogFileRef,
    includeParserDebugFileRef: pending.includeParserDebugFileRef,
  });

  const hasStructuredDiagnostics =
    pipelineResult.state.errors.length > 0 || pipelineResult.state.testFailures.length > 0;
  const fallbackContent =
    response.isError &&
    pending.errorFallbackPolicy === 'if-no-structured-diagnostics' &&
    hasStructuredDiagnostics
      ? []
      : pending.fallbackContent;

  return {
    ...response,
    content: response.isError
      ? [...pipelineResult.mcpContent, ...fallbackContent]
      : pipelineResult.mcpContent,
    _meta: createPipelineOutputMeta(
      pipelineResult.events,
      pipelineResult.mcpContent.length,
      pending.extras,
      'complete',
    ),
  };
}
