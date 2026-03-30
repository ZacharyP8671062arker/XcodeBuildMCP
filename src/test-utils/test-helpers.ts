/**
 * Shared test helpers for extracting text content from tool responses.
 */

import { expect } from 'vitest';
import type { ToolResponse } from '../types/common.ts';

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
