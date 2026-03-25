import type { ToolResponse } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { sessionStore } from '../../../utils/session-store.ts';
import { readXcodeIdeState } from '../../../utils/xcode-state-reader.ts';
import { lookupBundleId } from '../../../utils/xcode-state-watcher.ts';
import * as z from 'zod';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';

const schemaObj = z.object({});

type Params = z.infer<typeof schemaObj>;

interface SyncXcodeDefaultsContext {
  executor: CommandExecutor;
  cwd: string;
  projectPath?: string;
  workspacePath?: string;
}

export async function syncXcodeDefaultsLogic(
  _params: Params,
  ctx: SyncXcodeDefaultsContext,
): Promise<ToolResponse> {
  const xcodeState = await readXcodeIdeState({
    executor: ctx.executor,
    cwd: ctx.cwd,
    projectPath: ctx.projectPath,
    workspacePath: ctx.workspacePath,
  });

  if (xcodeState.error) {
    return toolResponse([
      header('Sync Xcode Defaults'),
      statusLine('error', `Failed to read Xcode IDE state: ${xcodeState.error}`),
    ]);
  }

  const synced: Record<string, string> = {};

  if (xcodeState.scheme) {
    synced.scheme = xcodeState.scheme;
  }

  if (xcodeState.simulatorId) {
    synced.simulatorId = xcodeState.simulatorId;
  }

  if (xcodeState.simulatorName) {
    synced.simulatorName = xcodeState.simulatorName;
  }

  if (xcodeState.scheme) {
    const bundleId = await lookupBundleId(
      ctx.executor,
      xcodeState.scheme,
      ctx.projectPath,
      ctx.workspacePath,
    );
    if (bundleId) {
      synced.bundleId = bundleId;
    }
  }

  if (Object.keys(synced).length === 0) {
    return toolResponse([
      header('Sync Xcode Defaults'),
      statusLine('info', 'No scheme or simulator selection detected in Xcode IDE state.'),
    ]);
  }

  sessionStore.setDefaults(synced);

  const items = Object.entries(synced).map(([k, v]) => ({ label: k, value: v }));

  return toolResponse([
    header('Sync Xcode Defaults'),
    detailTree(items),
    statusLine('success', 'Synced session defaults from Xcode IDE.'),
  ]);
}

export const schema = schemaObj.shape;

export const handler = createTypedToolWithContext(schemaObj, syncXcodeDefaultsLogic, () => {
  const { projectPath, workspacePath } = sessionStore.getAll();
  return {
    executor: getDefaultCommandExecutor(),
    cwd: process.cwd(),
    projectPath,
    workspacePath,
  };
});
