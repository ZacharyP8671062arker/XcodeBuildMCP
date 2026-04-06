/**
 * Shared test helpers for extracting text content from tool responses.
 */

import { expect } from 'vitest';
import type { ToolHandlerContext, ImageAttachment } from '../rendering/types.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import { renderEvents } from '../rendering/render.ts';
import { handlerContextStorage } from '../utils/typed-tool-factory.ts';

/**
 * Extract and join all text content items from a tool response.
 */
export function allText(
  result: ToolResponse | { content: Array<{ type: string; text?: string }> },
): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Assert that a tool response represents a pending xcodebuild result
 * with an optional next-step tool reference.
 */
export interface MockToolHandlerResult {
  events: PipelineEvent[];
  attachments: ImageAttachment[];
  nextStepParams?: NextStepParamsMap;
  text(): string;
  isError(): boolean;
}

export function createMockToolHandlerContext(): {
  ctx: ToolHandlerContext;
  result: MockToolHandlerResult;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  let fallbackResponse: ToolResponse | null = null;
  const ctx: ToolHandlerContext = {
    emit: (event) => {
      events.push(event);
    },
    attach: (image) => {
      attachments.push(image);
    },
  };
  const resultObj: MockToolHandlerResult = {
    events,
    attachments,
    get nextStepParams() {
      if (fallbackResponse?.nextStepParams) return fallbackResponse.nextStepParams;
      return ctx.nextStepParams;
    },
    text() {
      if (fallbackResponse) return allText(fallbackResponse);
      return renderEvents(events, 'text');
    },
    isError() {
      if (fallbackResponse) return fallbackResponse.isError === true;
      return events.some(
        (e) =>
          (e.type === 'status-line' && e.level === 'error') ||
          (e.type === 'summary' && e.status === 'FAILED'),
      );
    },
  };
  return {
    ctx,
    result: resultObj,
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      const value = await handlerContextStorage.run(ctx, fn);
      if (value && typeof value === 'object' && 'content' in (value as Record<string, unknown>)) {
        fallbackResponse = value as unknown as ToolResponse;
      }
      return value;
    },
  };
}

export function expectPendingBuildResponse(result: ToolResponse, nextStepToolId?: string): void {
  expect(result.content).toEqual([]);
  expect(result._meta).toEqual(
    expect.objectContaining({
      pendingXcodebuild: expect.objectContaining({
        kind: 'pending-xcodebuild',
      }),
    }),
  );

  if (nextStepToolId) {
    expect(result.nextStepParams).toEqual(
      expect.objectContaining({
        [nextStepToolId]: expect.any(Object),
      }),
    );
  } else {
    expect(result.nextStepParams).toBeUndefined();
  }
}
