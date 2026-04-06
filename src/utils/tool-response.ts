import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import { resolveRenderers } from './renderers/index.ts';

export interface ToolResponseOptions {
  nextStepParams?: NextStepParamsMap;
  suppressCliStream?: boolean;
}

export function toolResponse(events: PipelineEvent[], options?: ToolResponseOptions): ToolResponse {
  const { renderers, mcpRenderer } = resolveRenderers();
  const hasCliRenderer = renderers.length > 1;
  const skipCliStream = hasCliRenderer && options?.suppressCliStream === true;
  const meta: Record<string, unknown> = {};

  if (events.length > 0) {
    meta.events = [...events];
  }

  for (const event of events) {
    for (const renderer of renderers) {
      if (skipCliStream && renderer !== mcpRenderer) continue;
      renderer.onEvent(event);
    }
  }

  for (const renderer of renderers) {
    if (skipCliStream && renderer !== mcpRenderer) continue;
    renderer.finalize();
  }

  const hasError = events.some(
    (e) =>
      (e.type === 'status-line' && e.level === 'error') ||
      (e.type === 'summary' && e.status === 'FAILED'),
  );

  if (!skipCliStream && hasCliRenderer) {
    meta.streamedEventCount = events.length;
    meta.streamedContentCount = mcpRenderer.getContent().length;
    meta.pipelineStreamMode = 'complete';
  }

  return {
    content: mcpRenderer.getContent(),
    isError: hasError || undefined,
    nextStepParams: options?.nextStepParams,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}
