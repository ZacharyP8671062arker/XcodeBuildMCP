import type {
  XcodebuildOperation,
  XcodebuildStage,
  PipelineEvent,
} from '../types/pipeline-events.ts';
import type { ToolResponseContent } from '../types/common.ts';
import { createXcodebuildEventParser } from './xcodebuild-event-parser.ts';
import { createXcodebuildRunState } from './xcodebuild-run-state.ts';
import type { XcodebuildRunState } from './xcodebuild-run-state.ts';
import { resolveRenderers } from './renderers/index.ts';
import type { XcodebuildRenderer } from './renderers/index.ts';
import { displayPath } from './build-preflight.ts';
import { formatDeviceId } from './device-name-resolver.ts';

export interface PipelineOptions {
  operation: XcodebuildOperation;
  toolName: string;
  params: Record<string, unknown>;
  minimumStage?: XcodebuildStage;
}

export interface PipelineResult {
  state: XcodebuildRunState;
  mcpContent: ToolResponseContent[];
  events: PipelineEvent[];
}

export interface PipelineFinalizeOptions {
  emitSummary?: boolean;
  tailEvents?: PipelineEvent[];
}

export interface XcodebuildPipeline {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  emitEvent(event: PipelineEvent): void;
  finalize(
    succeeded: boolean,
    durationMs?: number,
    options?: PipelineFinalizeOptions,
  ): PipelineResult;
  highestStageRank(): number;
}

export interface StartedPipeline {
  pipeline: XcodebuildPipeline;
  startedAt: number;
}

function buildHeaderParams(
  params: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  const keyLabelMap: Record<string, string> = {
    scheme: 'Scheme',
    workspacePath: 'Workspace',
    projectPath: 'Project',
    configuration: 'Configuration',
    platform: 'Platform',
    simulatorName: 'Simulator',
    simulatorId: 'Simulator',
    deviceId: 'Device',
    arch: 'Architecture',
    xcresultPath: 'xcresult',
    file: 'File',
    targetFilter: 'Target Filter',
  };

  const pathKeys = new Set(['workspacePath', 'projectPath', 'xcresultPath']);

  for (const [key, label] of Object.entries(keyLabelMap)) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) {
      if (key === 'projectPath' && typeof params.workspacePath === 'string') {
        continue;
      }
      if (key === 'simulatorId' && typeof params.simulatorName === 'string') {
        continue;
      }
      let displayValue: string;
      if (pathKeys.has(key)) {
        displayValue = displayPath(value);
      } else if (key === 'deviceId') {
        displayValue = formatDeviceId(value);
      } else {
        displayValue = value;
      }
      result.push({ label, value: displayValue });
    }
  }

  return result;
}

/**
 * Creates a pipeline, emits the initial header event, and captures the start
 * timestamp. This consolidates the repeated create-then-emit-start pattern used
 * across all build and test tool implementations.
 */
export function startBuildPipeline(
  options: PipelineOptions & { message: string },
): StartedPipeline {
  const pipeline = createXcodebuildPipeline(options);

  pipeline.emitEvent({
    type: 'header',
    timestamp: new Date().toISOString(),
    operation: options.message
      .replace(/^[^\p{L}]+/u, '')
      .split('\n')[0]
      .trim(),
    params: buildHeaderParams(options.params),
  });

  return { pipeline, startedAt: Date.now() };
}

export function createXcodebuildPipeline(options: PipelineOptions): XcodebuildPipeline {
  const { renderers, mcpRenderer } = resolveRenderers();

  const runState = createXcodebuildRunState({
    operation: options.operation,
    minimumStage: options.minimumStage,
    onEvent: (event: PipelineEvent) => {
      for (const renderer of renderers) {
        renderer.onEvent(event);
      }
    },
  });

  const parser = createXcodebuildEventParser({
    operation: options.operation,
    onEvent: (event: PipelineEvent) => {
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

    emitEvent(event: PipelineEvent): void {
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
