import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import { resolveRenderers } from './renderers/index.ts';

export interface ToolResponseOptions {
  nextStepParams?: NextStepParamsMap;
}

export function toolResponse(events: PipelineEvent[], options?: ToolResponseOptions): ToolResponse {
  const { renderers, mcpRenderer } = resolveRenderers();
  const hasCliRenderer = renderers.length > 1;

  for (const event of events) {
    for (const renderer of renderers) {
      renderer.onEvent(event);
    }
  }

  for (const renderer of renderers) {
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
    ...(hasCliRenderer ? { _meta: { pipelineStreamMode: 'complete' } } : {}),
  };
}
