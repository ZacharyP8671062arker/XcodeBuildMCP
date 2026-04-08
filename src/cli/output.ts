import type { OutputStyle } from '../types/common.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';
import type { ImageAttachment } from '../rendering/types.ts';
import { createCliTextRenderer } from '../utils/renderers/cli-text-renderer.ts';
import { formatCliTextLine } from '../utils/terminal-output.ts';

export type OutputFormat = 'text' | 'json' | 'raw';

export interface PrintSessionOutputOptions {
  format?: OutputFormat;
  style?: OutputStyle;
}

export interface SessionOutputData {
  text: string;
  events: PipelineEvent[];
  attachments: readonly ImageAttachment[];
  isError: boolean;
}

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function extractRenderedNextSteps(text: string): string {
  const nextStepsIndex = text.lastIndexOf('\n\nNext steps:\n');
  if (nextStepsIndex >= 0) {
    return text.slice(nextStepsIndex + 2).trim();
  }

  if (text.startsWith('Next steps:\n')) {
    return text.trim();
  }

  return '';
}

const CLI_RENDERABLE_EVENT_TYPES = new Set<PipelineEvent['type']>([
  'header',
  'status-line',
  'summary',
  'section',
  'detail-tree',
  'table',
  'file-ref',
  'next-steps',
  'build-stage',
  'compiler-warning',
  'compiler-error',
  'test-discovery',
  'test-progress',
  'test-failure',
]);

function isCliRenderableEvent(event: unknown): event is PipelineEvent {
  if (typeof event !== 'object' || event === null || !('type' in event)) {
    return false;
  }

  return CLI_RENDERABLE_EVENT_TYPES.has((event as { type: PipelineEvent['type'] }).type);
}

function getRenderableEvents(events: PipelineEvent[]): PipelineEvent[] | null {
  if (events.length === 0) {
    return null;
  }

  return events.every(isCliRenderableEvent) ? events : null;
}

function renderEvents(events: readonly PipelineEvent[]): boolean {
  if (events.length === 0) {
    return false;
  }

  const renderer = createCliTextRenderer({ interactive: process.stdout.isTTY === true });
  for (const event of events) {
    renderer.onEvent(event);
  }
  renderer.finalize();
  return true;
}

function hasNextStepsEvent(events: readonly PipelineEvent[]): boolean {
  return events.some((event) => event.type === 'next-steps');
}

/**
 * Print session output to the terminal.
 * Reads directly from RenderSession data (events, text, attachments, isError).
 */
export function printSessionOutput(
  data: SessionOutputData,
  options: PrintSessionOutputOptions = {},
): void {
  const { format = 'text', style = 'normal' } = options;

  if (process.env.XCODEBUILDMCP_VERBOSE === '1') {
    if (!data.isError && style !== 'minimal') {
      const nextStepsText = extractRenderedNextSteps(data.text);
      if (nextStepsText.length > 0) {
        writeLine('');
        writeLine(nextStepsText);
      }
    }
    if (data.isError) {
      process.exitCode = 1;
    }
    return;
  }

  if (format === 'json') {
    for (const event of data.events) {
      writeLine(JSON.stringify(event));
    }
  } else {
    const renderableEvents = getRenderableEvents(data.events);

    if (renderableEvents) {
      renderEvents(renderableEvents);

      if (style !== 'minimal' && !hasNextStepsEvent(renderableEvents)) {
        const nextStepsText = extractRenderedNextSteps(data.text);
        if (nextStepsText.length > 0) {
          writeLine(nextStepsText);
        }
      }

      printMediaAttachments(data.attachments);
    } else {
      printTextOutput(data.text);
    }
  }

  if (data.isError) {
    process.exitCode = 1;
  }
}

function printTextOutput(text: string): boolean {
  if (!text) {
    return false;
  }

  for (const line of text.split('\n')) {
    writeLine(formatCliTextLine(line));
  }
  return true;
}

function printMediaAttachments(attachments: readonly ImageAttachment[]): boolean {
  let printed = false;

  for (const attachment of attachments) {
    printed = printResponseImageItem(attachment.data, attachment.mimeType) || printed;
  }

  return printed;
}

function printResponseImageItem(data: string, mimeType: string): boolean {
  const sizeKb = Math.round((data.length * 3) / 4 / 1024);
  writeLine(`[Image: ${mimeType}, ~${sizeKb}KB base64]`);
  writeLine('  Use --output json to get the full image data');
  return true;
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
