import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import { renderEvents } from '../rendering/render.ts';

export interface EventsToToolResponseOptions {
  nextStepParams?: NextStepParamsMap;
}

/**
 * Convert pipeline events into a ToolResponse without the renderer side-effects
 * of toolResponse(). Use this for non-handler call sites (CLI, resources, tests)
 * that need a plain ToolResponse from a list of events.
 */
export function eventsToToolResponse(
  events: PipelineEvent[],
  options?: EventsToToolResponseOptions,
): ToolResponse {
  const rendered = renderEvents(events, 'text');

  const hasError = events.some(
    (e) =>
      (e.type === 'status-line' && e.level === 'error') ||
      (e.type === 'summary' && e.status === 'FAILED'),
  );

  const meta: Record<string, unknown> = {};
  if (events.length > 0) {
    meta.events = [...events];
  }

  return {
    content: [{ type: 'text', text: rendered }],
    isError: hasError || undefined,
    nextStepParams: options?.nextStepParams,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}
