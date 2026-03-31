import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSnapshotOutput } from './normalize.ts';

const PROCESS_UPTIME_MS_REGEX = /"uptimeMs"\s*:\s*\d+/g;
const PROCESS_RSS_BYTES_REGEX = /"rssBytes"\s*:\s*\d+/g;
const PROCESS_HEAP_BYTES_REGEX = /"heapUsedBytes"\s*:\s*\d+/g;
const PROCESS_TREE_LINE_REGEX = /^ {2}\d+ \(ppid \d+\): .+$/gm;

function normalizeResourceOutput(text: string): string {
  let normalized = normalizeSnapshotOutput(text);
  normalized = normalized.replace(PROCESS_UPTIME_MS_REGEX, '"uptimeMs": <UPTIME>');
  normalized = normalized.replace(PROCESS_RSS_BYTES_REGEX, '"rssBytes": <BYTES>');
  normalized = normalized.replace(PROCESS_HEAP_BYTES_REGEX, '"heapUsedBytes": <BYTES>');
  normalized = normalized.replace(PROCESS_TREE_LINE_REGEX, '   <PID> (ppid <PID>): <PROCESS>');
  return normalized;
}
import { loadManifest } from '../core/manifest/load-manifest.ts';
import type { ResourceManifestEntry } from '../core/manifest/schema.ts';

export interface ResourceSnapshotResult {
  text: string;
  rawText: string;
}

function resolveResourceManifest(resourceId: string): ResourceManifestEntry | null {
  const manifest = loadManifest();
  return manifest.resources.get(resourceId) ?? null;
}

async function importResourceModule(modulePath: string) {
  const sourceModulePath = path.resolve(process.cwd(), 'src', `${modulePath}.ts`);
  const sourceModuleUrl = pathToFileURL(sourceModulePath).href;

  return (await import(sourceModuleUrl)) as {
    handler: (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
  };
}

export async function invokeResource(resourceId: string): Promise<ResourceSnapshotResult> {
  const manifest = resolveResourceManifest(resourceId);
  if (!manifest) {
    throw new Error(`Resource '${resourceId}' not found in manifest`);
  }

  const mod = await importResourceModule(manifest.module);
  const uri = new URL(manifest.uri);

  const result = await mod.handler(uri);
  const rawText = result.contents.map((c) => c.text).join('\n') + '\n';

  return {
    text: normalizeResourceOutput(rawText),
    rawText,
  };
}
