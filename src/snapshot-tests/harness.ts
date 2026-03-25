import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { normalizeSnapshotOutput } from './normalize.ts';
import { loadManifest } from '../core/manifest/load-manifest.ts';
import { getEffectiveCliName } from '../core/manifest/schema.ts';
import { importToolModule } from '../core/manifest/import-tool-module.ts';
import type { ToolResponse } from '../types/common.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');

export interface SnapshotHarness {
  invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult>;
  cleanup(): void;
}

export interface SnapshotResult {
  text: string;
  isError: boolean;
}

function resolveToolManifest(
  workflowId: string,
  cliToolName: string,
): { toolModulePath: string; isMcpOnly: boolean } | null {
  const manifest = loadManifest();
  const workflow = manifest.workflows.get(workflowId);
  if (!workflow) return null;

  const isMcpOnly = !workflow.availability.cli;

  for (const toolId of workflow.tools) {
    const tool = manifest.tools.get(toolId);
    if (!tool) continue;
    if (getEffectiveCliName(tool) === cliToolName) {
      return { toolModulePath: tool.module, isMcpOnly };
    }
  }

  return null;
}

function toolResponseToText(response: ToolResponse): string {
  const parts: string[] = [];
  for (const item of response.content ?? []) {
    if (item.type === 'text') {
      parts.push(item.text);
    }
  }
  return parts.join('\n') + '\n';
}

export async function createSnapshotHarness(): Promise<SnapshotHarness> {
  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const resolved = resolveToolManifest(workflow, cliToolName);

    if (resolved?.isMcpOnly) {
      return invokeDirect(resolved.toolModulePath, args);
    }

    return invokeCli(workflow, cliToolName, args);
  }

  async function invokeCli(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const jsonArg = JSON.stringify(args);
    const { VITEST, NODE_ENV, ...cleanEnv } = process.env;
    const result = spawnSync('node', [CLI_PATH, workflow, cliToolName, '--json', jsonArg], {
      encoding: 'utf8',
      timeout: 120000,
      cwd: process.cwd(),
      env: cleanEnv,
    });

    const stdout = result.stdout ?? '';
    return {
      text: normalizeSnapshotOutput(stdout),
      isError: result.status !== 0,
    };
  }

  async function invokeDirect(
    toolModulePath: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const toolModule = await importToolModule(toolModulePath);
    const prev = process.env.SNAPSHOT_TEST_REAL_EXECUTOR;
    process.env.SNAPSHOT_TEST_REAL_EXECUTOR = '1';
    try {
      const response = (await toolModule.handler(args)) as ToolResponse;
      const rawText = toolResponseToText(response);
      return {
        text: normalizeSnapshotOutput(rawText),
        isError: response.isError === true,
      };
    } finally {
      if (prev === undefined) {
        delete process.env.SNAPSHOT_TEST_REAL_EXECUTOR;
      } else {
        process.env.SNAPSHOT_TEST_REAL_EXECUTOR = prev;
      }
    }
  }

  function cleanup(): void {}

  return { invoke, cleanup };
}

export async function ensureSimulatorBooted(simulatorName: string): Promise<string> {
  const listOutput = execSync('xcrun simctl list devices available --json', {
    encoding: 'utf8',
  });
  const data = JSON.parse(listOutput) as {
    devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
  };

  for (const runtime of Object.values(data.devices)) {
    for (const device of runtime) {
      if (device.name === simulatorName) {
        if (device.state !== 'Booted') {
          execSync(`xcrun simctl boot ${device.udid}`, { encoding: 'utf8' });
        }
        return device.udid;
      }
    }
  }

  throw new Error(`Simulator "${simulatorName}" not found`);
}
