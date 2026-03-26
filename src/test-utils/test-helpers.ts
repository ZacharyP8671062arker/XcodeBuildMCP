/**
 * Shared test helpers for extracting text content from tool responses.
 */

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
