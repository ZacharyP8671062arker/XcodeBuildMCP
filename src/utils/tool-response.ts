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

  return {
    content: mcpRenderer.getContent(),
    isError: hasError || undefined,
    nextStepParams: options?.nextStepParams,
    ...(!skipCliStream && hasCliRenderer ? { _meta: { pipelineStreamMode: 'complete' } } : {}),
  };
}
