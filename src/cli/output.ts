import type { ToolResponse, OutputStyle } from '../types/common.ts';
import { formatCliTextLine } from '../utils/terminal-output.ts';

export type OutputFormat = 'text' | 'json';

export interface PrintToolResponseOptions {
  format?: OutputFormat;
  style?: OutputStyle;
}

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function extractRenderedNextSteps(response: ToolResponse): string {
  for (let index = (response.content?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = response.content?.[index];
    if (!item || item.type !== 'text') {
      continue;
    }

    const nextStepsIndex = item.text.lastIndexOf('\n\nNext steps:\n');
    if (nextStepsIndex >= 0) {
      return item.text.slice(nextStepsIndex + 2).trim();
    }

    if (item.text.startsWith('Next steps:\n')) {
      return item.text.trim();
    }
  }

  return '';
}

function isCompletePipelineStream(response: ToolResponse): boolean {
  return (
    response._meta?.xcodebuildStreamMode === 'complete' ||
    response._meta?.pipelineStreamMode === 'complete'
  );
}

/**
 * Print a tool response to the terminal.
 * Applies runtime-aware rendering of next steps for CLI output.
 */
export function printToolResponse(
  response: ToolResponse,
  options: PrintToolResponseOptions = {},
): void {
  const { format = 'text', style = 'normal' } = options;

  if (isCompletePipelineStream(response)) {
    if (response.isError) {
      process.exitCode = 1;
    }
    return;
  }

  if (format === 'json') {
    // When events were streamed as JSONL during execution, skip re-printing them
    const hasStreamedEvents = Array.isArray(response._meta?.events);
    if (hasStreamedEvents) {
      const events = response._meta?.events as Array<Record<string, unknown>>;
      const streamedEventCount =
        typeof response._meta?.streamedEventCount === 'number'
          ? response._meta.streamedEventCount
          : events.length;
      const appendedEvents = events.slice(streamedEventCount);

      for (const event of appendedEvents) {
        writeLine(JSON.stringify(event));
      }

      // Events were already written to stdout as JSONL by the CLI JSONL renderer.
      // Only emit non-event content (error messages, etc.) if present.
      const nonEventContent = response.content?.filter(
        (item) => item.type !== 'text' || !item.text,
      );
      if (nonEventContent && nonEventContent.length > 0) {
        writeLine(JSON.stringify({ ...response, content: nonEventContent }, null, 2));
      }
    } else {
      writeLine(JSON.stringify(response, null, 2));
    }
  } else {
    const hasStreamedEvents = Array.isArray(response._meta?.events);
    const streamedContentCount =
      typeof response._meta?.streamedContentCount === 'number'
        ? response._meta.streamedContentCount
        : 0;

    if (hasStreamedEvents && process.stdout.isTTY === true) {
      const printedAny = printToolResponseText(response, streamedContentCount);
      if (!printedAny && style !== 'minimal') {
        const nextStepsText = extractRenderedNextSteps(response);
        if (nextStepsText.length > 0) {
          writeLine(nextStepsText);
        }
      }
    } else {
      printToolResponseText(response);
    }
  }

  if (response.isError) {
    process.exitCode = 1;
  }
}

/**
 * Print tool response content as text.
 */
function printToolResponseText(response: ToolResponse, skipItems: number = 0): boolean {
  let printed = false;
  const content = response.content ?? [];

  for (const [index, item] of content.entries()) {
    if (index < skipItems) {
      continue;
    }

    if (item.type === 'text') {
      for (const line of item.text.split('\n')) {
        writeLine(formatCliTextLine(line));
      }
      printed = true;
    } else if (item.type === 'image') {
      // For images, show a placeholder with metadata
      const sizeKb = Math.round((item.data.length * 3) / 4 / 1024);
      writeLine(`[Image: ${item.mimeType}, ~${sizeKb}KB base64]`);
      writeLine('  Use --output json to get the full image data');
      printed = true;
    }
  }

  return printed;
}

/**
 * Format a tool list for display.
 */
export function formatToolList(
  tools: Array<{ cliName: string; workflow: string; description?: string; stateful: boolean }>,
  options: { grouped?: boolean; verbose?: boolean } = {},
): string {
  const lines: string[] = [];

  if (options.grouped) {
    const byWorkflow = new Map<string, typeof tools>();
    for (const tool of tools) {
      let group = byWorkflow.get(tool.workflow);
      if (!group) {
        group = [];
        byWorkflow.set(tool.workflow, group);
      }
      group.push(tool);
    }

    const sortedWorkflows = [...byWorkflow.keys()].sort();
    for (const workflow of sortedWorkflows) {
      lines.push(`\n${workflow}:`);
      const workflowTools = byWorkflow.get(workflow) ?? [];
      const sortedTools = workflowTools.sort((a, b) => a.cliName.localeCompare(b.cliName));

      for (const tool of sortedTools) {
        const statefulMarker = tool.stateful ? ' [stateful]' : '';
        if (options.verbose && tool.description) {
          lines.push(`  ${tool.cliName}${statefulMarker}`);
          lines.push(`    ${tool.description}`);
        } else {
          const desc = tool.description ? ` - ${truncate(tool.description, 60)}` : '';
          lines.push(`  ${tool.cliName}${statefulMarker}${desc}`);
        }
      }
    }
  } else {
    const sortedTools = [...tools].sort((a, b) => {
      const aFull = `${a.workflow} ${a.cliName}`;
      const bFull = `${b.workflow} ${b.cliName}`;
      return aFull.localeCompare(bFull);
    });

    for (const tool of sortedTools) {
      const fullCommand = `${tool.workflow} ${tool.cliName}`;
      const statefulMarker = tool.stateful ? ' [stateful]' : '';
      if (options.verbose && tool.description) {
        lines.push(`${fullCommand}${statefulMarker}`);
        lines.push(`  ${tool.description}`);
      } else {
        const desc = tool.description ? ` - ${truncate(tool.description, 60)}` : '';
        lines.push(`${fullCommand}${statefulMarker}${desc}`);
      }
    }
  }

  return lines.join('\n');
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
