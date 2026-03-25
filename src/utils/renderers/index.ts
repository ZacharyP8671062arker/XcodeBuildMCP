import path from 'node:path';
import type { HeaderEvent, PipelineEvent } from '../../types/pipeline-events.ts';
import { createMcpRenderer } from './mcp-renderer.ts';
import { createCliTextRenderer } from './cli-text-renderer.ts';
import { createCliJsonlRenderer } from './cli-jsonl-renderer.ts';

export interface XcodebuildRenderer {
  onEvent(event: PipelineEvent): void;
  finalize(): void;
}

export function deriveDiagnosticBaseDir(event: HeaderEvent): string | null {
  for (const param of event.params) {
    if (param.label === 'Workspace' || param.label === 'Project') {
      return path.dirname(path.resolve(process.cwd(), param.value));
    }
  }
  return null;
}

export function resolveRenderers(): {
  renderers: XcodebuildRenderer[];
  mcpRenderer: ReturnType<typeof createMcpRenderer>;
} {
  const mcpRenderer = createMcpRenderer();
  const renderers: XcodebuildRenderer[] = [mcpRenderer];

  const runtime = process.env.XCODEBUILDMCP_RUNTIME;
  const outputFormat = process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;

  if (runtime === 'cli') {
    if (outputFormat === 'json') {
      renderers.push(createCliJsonlRenderer());
    } else {
      renderers.push(createCliTextRenderer({ interactive: process.stdout.isTTY === true }));
    }
  }

  return { renderers, mcpRenderer };
}

export { createMcpRenderer } from './mcp-renderer.ts';
export { createCliTextRenderer } from './cli-text-renderer.ts';
export { createCliJsonlRenderer } from './cli-jsonl-renderer.ts';
