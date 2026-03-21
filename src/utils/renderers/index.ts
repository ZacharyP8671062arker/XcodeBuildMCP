import path from 'node:path';
import type { StartEvent, XcodebuildEvent } from '../../types/xcodebuild-events.ts';

export interface XcodebuildRenderer {
  onEvent(event: XcodebuildEvent): void;
  finalize(): void;
}

export function deriveDiagnosticBaseDir(event: StartEvent): string | null {
  let paramsProjectPath: string | null = null;
  if (typeof event.params.projectPath === 'string') {
    paramsProjectPath = event.params.projectPath;
  } else if (typeof event.params.workspacePath === 'string') {
    paramsProjectPath = event.params.workspacePath;
  }

  if (paramsProjectPath) {
    return path.dirname(path.resolve(process.cwd(), paramsProjectPath));
  }

  const messageMatch = event.message.match(/^  (Project|Workspace): (.+)$/mu);
  if (!messageMatch) {
    return null;
  }

  return path.dirname(path.resolve(process.cwd(), messageMatch[2]));
}

export { createMcpRenderer } from './mcp-renderer.ts';
export { createCliTextRenderer } from './cli-text-renderer.ts';
export { createCliJsonlRenderer } from './cli-jsonl-renderer.ts';
