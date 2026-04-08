/**
 * Shared test helpers for extracting text content from tool responses.
 */

import { expect } from 'vitest';
import type { ToolHandlerContext, ImageAttachment } from '../rendering/types.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import type { ToolHandler } from '../utils/typed-tool-factory.ts';
import { renderEvents } from '../rendering/render.ts';
import { createRenderSession } from '../rendering/render.ts';
import { handlerContextStorage } from '../utils/typed-tool-factory.ts';

/**
 * Extract and join all text content items from a tool response.
 */
export function allText(result: {
  content: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }>;
}): string {
  return result.content
    .filter(
      (c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string',
    )
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
      return ctx.nextStepParams;
    },
    text() {
      return renderEvents(events, 'text');
    },
    isError() {
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
      return handlerContextStorage.run(ctx, fn);
    },
  };
}

export async function runToolLogic<T>(logic: () => Promise<T>): Promise<{
  response: T;
  result: MockToolHandlerResult;
}> {
  const { result, run } = createMockToolHandlerContext();
  const response = await run(logic);
  return { response, result };
}

export interface CallHandlerResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  nextStepParams?: NextStepParamsMap;
}

/**
 * Call a tool handler in test mode, providing a session context and
 * returning a ToolResponse-shaped result for backward-compatible assertions.
 */
export async function callHandler(
  handler:
    | ToolHandler
    | ((args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void>),
  args: Record<string, unknown>,
): Promise<CallHandlerResult> {
  const session = createRenderSession('text');
  const ctx: ToolHandlerContext = {
    emit: (event) => session.emit(event),
    attach: (image) => session.attach(image),
  };
  await handler(args, ctx);
  const text = session.finalize();
  return {
    content: text ? [{ type: 'text' as const, text }] : [],
    isError: session.isError() || undefined,
    nextStepParams: ctx.nextStepParams,
  };
}

function isMockToolHandlerResult(
  result: ToolResponse | MockToolHandlerResult,
): result is MockToolHandlerResult {
  return 'events' in result && Array.isArray(result.events) && typeof result.text === 'function';
}

export function expectPendingBuildResponse(
  result: ToolResponse | MockToolHandlerResult,
  nextStepToolId?: string,
): void {
  if (isMockToolHandlerResult(result)) {
    expect(result.events.some((event) => event.type === 'summary')).toBe(true);

    if (nextStepToolId) {
      expect(result.nextStepParams).toEqual(
        expect.objectContaining({
          [nextStepToolId]: expect.any(Object),
        }),
      );
    } else {
      expect(result.nextStepParams).toBeUndefined();
    }
    return;
  }

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
