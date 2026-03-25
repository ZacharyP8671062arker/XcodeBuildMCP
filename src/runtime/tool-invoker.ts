import type { ToolCatalog, ToolDefinition, ToolInvoker, InvokeOptions } from './types.ts';
import type { NextStep, NextStepParams, NextStepParamsMap, ToolResponse } from '../types/common.ts';
import { toolResponse } from '../utils/tool-response.ts';
import { statusLine } from '../utils/tool-event-builders.ts';
import { DaemonClient } from '../cli/daemon-client.ts';
import { ensureDaemonRunning, DEFAULT_DAEMON_STARTUP_TIMEOUT_MS } from '../cli/daemon-control.ts';
import { log } from '../utils/logger.ts';
import {
  recordInternalErrorMetric,
  recordToolInvocationMetric,
  type SentryToolInvocationOutcome,
  type SentryToolRuntime,
  type SentryToolTransport,
} from '../utils/sentry.ts';
import {
  finalizePendingXcodebuildResponse,
  isPendingXcodebuildResponse,
} from '../utils/xcodebuild-output.ts';
import { renderNextStepsSection } from '../utils/responses/next-steps-renderer.ts';
import type { RuntimeKind } from './types.ts';

type BuiltTemplateNextStep = {
  step: NextStep;
  templateToolId?: string;
};

function buildTemplateNextSteps(
  tool: ToolDefinition,
  catalog: ToolCatalog,
): BuiltTemplateNextStep[] {
  if (!tool.nextStepTemplates || tool.nextStepTemplates.length === 0) {
    return [];
  }

  const built: BuiltTemplateNextStep[] = [];
  for (const template of tool.nextStepTemplates) {
    if (!template.toolId) {
      built.push({
        step: {
          label: template.label,
          priority: template.priority,
          when: template.when,
        },
      });
      continue;
    }

    const target = catalog.getByToolId(template.toolId);
    if (!target) {
      continue;
    }

    built.push({
      step: {
        tool: target.mcpName,
        label: template.label,
        params: template.params ?? {},
        priority: template.priority,
        when: template.when,
      },
      templateToolId: template.toolId,
    });
  }

  return built;
}

function consumeDynamicParams(
  nextStepParams: NextStepParamsMap | undefined,
  toolId: string,
  consumedCounts: Map<string, number>,
): NextStepParams | undefined {
  const candidate = nextStepParams?.[toolId];
  if (!candidate) {
    return undefined;
  }

  if (Array.isArray(candidate)) {
    const current = consumedCounts.get(toolId) ?? 0;
    consumedCounts.set(toolId, current + 1);
    return candidate[current];
  }

  return candidate;
}

function mergeTemplateAndResponseNextSteps(
  templateSteps: BuiltTemplateNextStep[],
  responseParamsMap: NextStepParamsMap | undefined,
): NextStep[] {
  const consumedCounts = new Map<string, number>();

  return templateSteps.map((builtTemplateStep) => {
    const templateStep = builtTemplateStep.step;
    if (!builtTemplateStep.templateToolId || !templateStep.tool) {
      return templateStep;
    }

    const paramsFromMap = consumeDynamicParams(
      responseParamsMap,
      builtTemplateStep.templateToolId,
      consumedCounts,
    );
    if (!paramsFromMap) {
      return templateStep;
    }

    return {
      ...templateStep,
      params: {
        ...(templateStep.params ?? {}),
        ...paramsFromMap,
      },
    };
  });
}

function normalizeNextSteps(response: ToolResponse, catalog: ToolCatalog): ToolResponse {
  if (!response.nextSteps || response.nextSteps.length === 0) {
    return response;
  }

  return {
    ...response,
    nextSteps: response.nextSteps.map((step) => {
      if (!step.tool) {
        return step;
      }

      const target = catalog.getByMcpName(step.tool);
      if (!target) {
        return step;
      }

      return {
        ...step,
        tool: target.mcpName,
        workflow: target.workflow,
        cliTool: target.cliName,
      };
    }),
  };
}

function renderNextStepsIntoContent(response: ToolResponse, runtime: RuntimeKind): ToolResponse {
  if (!response.nextSteps || response.nextSteps.length === 0) {
    return response;
  }

  const section = renderNextStepsSection(response.nextSteps, runtime);
  if (!section) {
    return response;
  }

  const content = [...response.content];
  let lastTextIndex = -1;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'text') {
      lastTextIndex = i;
      break;
    }
  }
  if (lastTextIndex >= 0) {
    const lastItem = content[lastTextIndex];
    content[lastTextIndex] = { ...lastItem, text: `${lastItem.text}\n\n${section}` };
  } else {
    content.push({ type: 'text', text: section });
  }

  return { ...response, content };
}

export function postProcessToolResponse(params: {
  tool: ToolDefinition;
  response: ToolResponse;
  catalog: ToolCatalog;
  runtime: InvokeOptions['runtime'];
  applyTemplateNextSteps?: boolean;
}): ToolResponse {
  const { tool, response, catalog, runtime, applyTemplateNextSteps = true } = params;

  const isError = response.isError === true;
  const suppressNextStepsForStructuredFailure =
    isError && (isPendingXcodebuildResponse(response) || Array.isArray(response._meta?.events));
  const responseForNextSteps = suppressNextStepsForStructuredFailure
    ? {
        ...response,
        nextSteps: undefined,
        nextStepParams: undefined,
      }
    : response;

  const allTemplateSteps = buildTemplateNextSteps(tool, catalog);
  const templateSteps = allTemplateSteps.filter((t) => {
    const when = t.step.when ?? 'success';
    if (when === 'success') return !isError;
    if (when === 'failure') return isError;
    return true;
  });

  const withTemplates =
    !suppressNextStepsForStructuredFailure && applyTemplateNextSteps && templateSteps.length > 0
      ? {
          ...responseForNextSteps,
          nextSteps: mergeTemplateAndResponseNextSteps(
            templateSteps,
            responseForNextSteps.nextStepParams,
          ),
        }
      : responseForNextSteps;

  const normalized = normalizeNextSteps(withTemplates, catalog);

  const finalized = isPendingXcodebuildResponse(normalized)
    ? finalizePendingXcodebuildResponse(normalized, {
        nextSteps: normalized.nextSteps,
      })
    : renderNextStepsIntoContent(normalized, runtime);

  const { nextSteps: _ns, nextStepParams: _nsp, ...result } = finalized;
  return result;
}

function buildDaemonEnvOverrides(opts: InvokeOptions): Record<string, string> | undefined {
  if (!opts.logLevel) {
    return undefined;
  }
  return { XCODEBUILDMCP_DAEMON_LOG_LEVEL: opts.logLevel };
}

function getErrorKind(error: unknown): string {
  return error instanceof Error ? error.name || 'Error' : typeof error;
}

function mapRuntimeToSentryToolRuntime(runtime: InvokeOptions['runtime']): SentryToolRuntime {
  if (runtime === 'daemon' || runtime === 'mcp') {
    return runtime;
  }
  return 'cli';
}

export class DefaultToolInvoker implements ToolInvoker {
  constructor(private catalog: ToolCatalog) {}

  async invoke(
    toolName: string,
    args: Record<string, unknown>,
    opts: InvokeOptions,
  ): Promise<ToolResponse> {
    const resolved = this.catalog.resolve(toolName);

    if (resolved.ambiguous) {
      return toolResponse([
        statusLine(
          'error',
          `Ambiguous tool name: Multiple tools match '${toolName}'. Use one of:\n- ${resolved.ambiguous.join('\n- ')}`,
        ),
      ]);
    }

    if (resolved.notFound || !resolved.tool) {
      return toolResponse([
        statusLine(
          'error',
          `Tool not found: Unknown tool '${toolName}'. Run 'xcodebuildmcp tools' to see available tools.`,
        ),
      ]);
    }

    return this.executeTool(resolved.tool, args, opts);
  }

  /**
   * Invoke a tool directly, bypassing catalog resolution.
   * Used by CLI where the correct ToolDefinition is already known
   * from workflow-scoped yargs routing.
   */
  async invokeDirect(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    opts: InvokeOptions,
  ): Promise<ToolResponse> {
    return this.executeTool(tool, args, opts);
  }

  private async invokeViaDaemon(
    opts: InvokeOptions,
    invoke: (client: DaemonClient) => Promise<ToolResponse>,
    context: {
      label: string;
      errorTitle: string;
      captureInfraErrorMetric: (error: unknown) => void;
      captureInvocationMetric: (outcome: SentryToolInvocationOutcome) => void;
      postProcessParams: {
        tool: ToolDefinition;
        catalog: ToolCatalog;
        runtime: InvokeOptions['runtime'];
      };
    },
  ): Promise<ToolResponse> {
    const socketPath = opts.socketPath;
    if (!socketPath) {
      const error = new Error('SocketPathMissing');
      context.captureInfraErrorMetric(error);
      context.captureInvocationMetric('infra_error');
      return toolResponse([
        statusLine(
          'error',
          'Socket path required: No socket path configured for daemon communication.',
        ),
      ]);
    }

    const client = new DaemonClient({ socketPath });
    const isRunning = await client.isRunning();

    if (!isRunning) {
      try {
        await ensureDaemonRunning({
          socketPath,
          workspaceRoot: opts.workspaceRoot,
          startupTimeoutMs: opts.daemonStartupTimeoutMs ?? DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
          env: buildDaemonEnvOverrides(opts),
        });
      } catch (error) {
        log(
          'error',
          `[infra/tool-invoker] ${context.label} daemon auto-start failed (${getErrorKind(error)})`,
          { sentry: true },
        );
        context.captureInfraErrorMetric(error);
        context.captureInvocationMetric('infra_error');
        return toolResponse([
          statusLine(
            'error',
            `Daemon auto-start failed: ${error instanceof Error ? error.message : String(error)}\n\nYou can try starting the daemon manually:\n  xcodebuildmcp daemon start`,
          ),
        ]);
      }
    }

    try {
      const response = await invoke(client);
      context.captureInvocationMetric('completed');
      return postProcessToolResponse({
        ...context.postProcessParams,
        response,
        applyTemplateNextSteps: false,
      });
    } catch (error) {
      log(
        'error',
        `[infra/tool-invoker] ${context.label} transport failed (${getErrorKind(error)})`,
        { sentry: true },
      );
      context.captureInfraErrorMetric(error);
      context.captureInvocationMetric('infra_error');
      return toolResponse([
        statusLine(
          'error',
          `${context.errorTitle}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ]);
    }
  }

  private async executeTool(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    opts: InvokeOptions,
  ): Promise<ToolResponse> {
    const startedAt = Date.now();
    const runtime = mapRuntimeToSentryToolRuntime(opts.runtime);
    let transport: SentryToolTransport = 'direct';

    const captureInvocationMetric = (outcome: SentryToolInvocationOutcome): void => {
      recordToolInvocationMetric({
        toolName: tool.mcpName,
        runtime,
        transport,
        outcome,
        durationMs: Date.now() - startedAt,
      });
    };

    const captureInfraErrorMetric = (error: unknown): void => {
      recordInternalErrorMetric({
        component: 'tool-invoker',
        runtime,
        errorKind: getErrorKind(error),
      });
    };

    const postProcessParams = { tool, catalog: this.catalog, runtime: opts.runtime };
    const xcodeIdeRemoteToolName = tool.xcodeIdeRemoteToolName;
    const isDynamicXcodeIdeTool =
      tool.workflow === 'xcode-ide' && typeof xcodeIdeRemoteToolName === 'string';

    if (opts.runtime === 'cli' && isDynamicXcodeIdeTool) {
      transport = 'xcode-ide-daemon';
      return this.invokeViaDaemon(
        opts,
        (client) => client.invokeXcodeIdeTool(xcodeIdeRemoteToolName, args),
        {
          label: 'xcode-ide',
          errorTitle: 'Xcode IDE invocation failed',
          captureInfraErrorMetric,
          captureInvocationMetric,
          postProcessParams,
        },
      );
    }

    if (opts.runtime === 'cli' && tool.stateful) {
      transport = 'daemon';
      return this.invokeViaDaemon(opts, (client) => client.invokeTool(tool.mcpName, args), {
        label: `daemon/${tool.mcpName}`,
        errorTitle: 'Daemon invocation failed',
        captureInfraErrorMetric,
        captureInvocationMetric,
        postProcessParams,
      });
    }

    // Direct invocation (CLI stateless or daemon internal)
    try {
      const response = await tool.handler(args);
      captureInvocationMetric('completed');
      return postProcessToolResponse({
        ...postProcessParams,
        response,
      });
    } catch (error) {
      log(
        'error',
        `[infra/tool-invoker] direct tool handler failed for ${tool.mcpName} (${getErrorKind(error)})`,
        { sentry: true },
      );
      captureInfraErrorMetric(error);
      captureInvocationMetric('infra_error');
      const message = error instanceof Error ? error.message : String(error);
      return toolResponse([statusLine('error', `Tool execution failed: ${message}`)]);
    }
  }
}
