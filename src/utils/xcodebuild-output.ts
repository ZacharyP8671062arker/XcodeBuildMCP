import type { NextStep, ToolResponse, ToolResponseContent } from '../types/common.ts';
import type {
  BuildRunResultNoticeData,
  BuildRunStepNoticeData,
  NoticeCode,
  NoticeLevel,
  XcodebuildEvent,
  XcodebuildOperation,
} from '../types/xcodebuild-events.ts';
import type { StartedPipeline } from './xcodebuild-pipeline.ts';

export interface PipelineOutputMetaExtras {
  [key: string]: unknown;
}

export type XcodebuildStreamMode = 'complete' | 'legacy';

interface PendingXcodebuildState {
  kind: 'pending-xcodebuild';
  started: StartedPipeline;
  emitSummary: boolean;
  extras: PipelineOutputMetaExtras;
  fallbackContent: ToolResponseContent[];
  tailEvents: XcodebuildEvent[];
  errorFallbackPolicy: ErrorFallbackPolicy;
}

export function createPipelineOutputMeta(
  events: XcodebuildEvent[],
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

export function createStructuredErrorEvent(
  operation: XcodebuildOperation,
  message: string,
): XcodebuildEvent {
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    operation,
    message,
    rawLine: message,
  };
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
): XcodebuildEvent {
  return {
    type: 'notice',
    timestamp: new Date().toISOString(),
    operation,
    level,
    message,
    code: options.code,
    data: options.data,
  };
}

export function createNextStepsEvent(steps: NextStep[]): XcodebuildEvent | null {
  if (steps.length === 0) {
    return null;
  }

  return {
    type: 'next-steps',
    timestamp: new Date().toISOString(),
    steps: steps.map((step) => ({
      label: step.label,
      tool: step.tool,
      workflow: step.workflow,
      cliTool: step.cliTool,
      params: step.params,
    })),
  };
}

export function appendStructuredEvents(
  response: ToolResponse,
  extraEvents: XcodebuildEvent[],
): ToolResponse {
  const existingEvents = Array.isArray(response._meta?.events)
    ? (response._meta.events as XcodebuildEvent[])
    : [];

  return {
    ...response,
    _meta: {
      ...(response._meta ?? {}),
      events: [...existingEvents, ...extraEvents],
    },
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
  started.pipeline.emitEvent(createNoticeEvent(operation, message, level, options));
}

export function emitPipelineError(
  started: StartedPipeline,
  operation: XcodebuildOperation,
  message: string,
): void {
  started.pipeline.emitEvent(createStructuredErrorEvent(operation, message));
}

export type ErrorFallbackPolicy = 'always' | 'if-no-structured-diagnostics';

export interface PendingXcodebuildResponseOptions {
  extras?: PipelineOutputMetaExtras;
  emitSummary?: boolean;
  tailEvents?: XcodebuildEvent[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
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
      } satisfies PendingXcodebuildState,
    },
  };
}

export function isPendingXcodebuildResponse(response: ToolResponse): boolean {
  return (
    typeof response._meta === 'object' &&
    response._meta !== null &&
    'pendingXcodebuild' in response._meta &&
    typeof response._meta.pendingXcodebuild === 'object' &&
    response._meta.pendingXcodebuild !== null &&
    (response._meta.pendingXcodebuild as PendingXcodebuildState).kind === 'pending-xcodebuild'
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
