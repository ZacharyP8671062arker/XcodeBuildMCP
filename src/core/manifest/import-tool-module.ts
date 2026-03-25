/**
 * Tool module importer with backward-compatible adapter.
 * Dynamically imports tool modules and adapts both old (PluginMeta default export)
 * and new (named exports) formats.
 */

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolSchemaShape } from '../plugin-types.ts';
import { getPackageRoot } from './load-manifest.ts';

export interface ImportedToolModule {
  schema: ToolSchemaShape;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

const moduleCache = new Map<string, ImportedToolModule>();

/**
 * Import a tool module by its manifest module path.
 *
 * Supports two module formats:
 * 1. Legacy: `export default { name, schema, handler, ... }`
 * 2. New: Named exports `{ schema, handler }`
 *
 * @param moduleId - Extensionless module path (e.g., 'mcp/tools/simulator/build_sim')
 * @returns Imported tool module with schema and handler
 */
export async function importToolModule(moduleId: string): Promise<ImportedToolModule> {
  const cached = moduleCache.get(moduleId);
  if (cached) {
    return cached;
  }

  const packageRoot = getPackageRoot();
  const modulePath = path.join(packageRoot, 'build', `${moduleId}.js`);
  const moduleUrl = pathToFileURL(modulePath).href;

  let mod: Record<string, unknown>;
  try {
    mod = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to import tool module '${moduleId}': ${err}`);
  }

  const result = extractToolExports(mod, moduleId);
  moduleCache.set(moduleId, result);

  return result;
}

function extractToolExports(mod: Record<string, unknown>, moduleId: string): ImportedToolModule {
  if (mod.default && typeof mod.default === 'object') {
    const defaultExport = mod.default as Record<string, unknown>;

    if (defaultExport.schema && typeof defaultExport.handler === 'function') {
      return {
        schema: defaultExport.schema as ToolSchemaShape,
        handler: defaultExport.handler as (params: Record<string, unknown>) => Promise<unknown>,
      };
    }
  }

  if (mod.schema && typeof mod.handler === 'function') {
    return {
      schema: mod.schema as ToolSchemaShape,
      handler: mod.handler as (params: Record<string, unknown>) => Promise<unknown>,
    };
  }

  throw new Error(
    `Tool module '${moduleId}' does not export the required shape. ` +
      `Expected either a default export with { schema, handler } or named exports { schema, handler }.`,
  );
}
