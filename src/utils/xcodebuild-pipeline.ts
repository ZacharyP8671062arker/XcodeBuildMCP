import type {
  XcodebuildOperation,
  XcodebuildStage,
  XcodebuildEvent,
} from '../types/xcodebuild-events.ts';
import type { ToolResponseContent } from '../types/common.ts';
import { createXcodebuildEventParser } from './xcodebuild-event-parser.ts';
import { createXcodebuildRunState } from './xcodebuild-run-state.ts';
import type { XcodebuildRunState } from './xcodebuild-run-state.ts';
import {
  createMcpRenderer,
  createCliTextRenderer,
  createCliJsonlRenderer,
} from './renderers/index.ts';
import type { XcodebuildRenderer } from './renderers/index.ts';

export interface PipelineOptions {
  operation: XcodebuildOperation;
  toolName: string;
  params: Record<string, unknown>;
  minimumStage?: XcodebuildStage;
}

export interface PipelineResult {
  state: XcodebuildRunState;
  mcpContent: ToolResponseContent[];
  events: XcodebuildEvent[];
}

export interface PipelineFinalizeOptions {
  emitSummary?: boolean;
  tailEvents?: XcodebuildEvent[];
}

export interface XcodebuildPipeline {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  emitEvent(event: XcodebuildEvent): void;
  finalize(
    succeeded: boolean,
    durationMs?: number,
    options?: PipelineFinalizeOptions,
  ): PipelineResult;
  highestStageRank(): number;
}

function resolveRenderers(): {
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

export interface StartedPipeline {
  pipeline: XcodebuildPipeline;
  startedAt: number;
}

/**
 * Creates a pipeline, emits the initial 'start' event, and captures the start
 * timestamp. This consolidates the repeated create-then-emit-start pattern used
 * across all build and test tool implementations.
 */
export function startBuildPipeline(
  options: PipelineOptions & { message: string },
): StartedPipeline {
  const pipeline = createXcodebuildPipeline(options);

  pipeline.emitEvent({
    type: 'start',
    timestamp: new Date().toISOString(),
    operation: options.operation,
    toolName: options.toolName,
    params: options.params,
    message: options.message,
  });

  return { pipeline, startedAt: Date.now() };
}

export function createXcodebuildPipeline(options: PipelineOptions): XcodebuildPipeline {
  const { renderers, mcpRenderer } = resolveRenderers();

  const runState = createXcodebuildRunState({
    operation: options.operation,
    minimumStage: options.minimumStage,
    onEvent: (event: XcodebuildEvent) => {
      for (const renderer of renderers) {
        renderer.onEvent(event);
      }
    },
  });

  const parser = createXcodebuildEventParser({
    operation: options.operation,
    onEvent: (event: XcodebuildEvent) => {
      runState.push(event);
    },
  });

  return {
    onStdout(chunk: string): void {
      parser.onStdout(chunk);
    },

    onStderr(chunk: string): void {
      parser.onStderr(chunk);
    },

    emitEvent(event: XcodebuildEvent): void {
      runState.push(event);
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      finalizeOptions?: PipelineFinalizeOptions,
    ): PipelineResult {
      parser.flush();
      const finalState = runState.finalize(succeeded, durationMs, {
        emitSummary: finalizeOptions?.emitSummary,
        tailEvents: finalizeOptions?.tailEvents,
      });

      for (const renderer of renderers) {
        renderer.finalize();
      }

      return {
        state: finalState,
        mcpContent: mcpRenderer.getContent(),
        events: finalState.events,
      };
    },

    highestStageRank(): number {
      return runState.highestStageRank();
    },
  };
}
