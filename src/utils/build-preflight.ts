import path from 'node:path';

export interface ToolPreflightParams {
  operation:
    | 'Build'
    | 'Build & Run'
    | 'Clean'
    | 'Test'
    | 'List Schemes'
    | 'Show Build Settings'
    | 'Get App Path';
  scheme?: string;
  workspacePath?: string;
  projectPath?: string;
  configuration?: string;
  platform?: string;
  simulatorName?: string;
  simulatorId?: string;
  deviceId?: string;
  arch?: string;
}

function displayPath(filePath: string): string {
  const cwd = process.cwd();
  const relative = path.relative(cwd, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return filePath;
  }
  return relative;
}

const OPERATION_EMOJI: Record<ToolPreflightParams['operation'], string> = {
  Build: '\u{1F528}',
  'Build & Run': '\u{1F680}',
  Clean: '\u{1F9F9}',
  Test: '\u{1F9EA}',
  'List Schemes': '\u{1F50D}',
  'Show Build Settings': '\u{1F50D}',
  'Get App Path': '\u{1F50D}',
};

export function formatToolPreflight(params: ToolPreflightParams): string {
  const emoji = OPERATION_EMOJI[params.operation];
  const lines: string[] = [`${emoji} ${params.operation}`, ''];

  if (params.scheme) {
    lines.push(`  Scheme: ${params.scheme}`);
  }

  if (params.workspacePath) {
    lines.push(`  Workspace: ${displayPath(params.workspacePath)}`);
  } else if (params.projectPath) {
    lines.push(`  Project: ${displayPath(params.projectPath)}`);
  }

  if (params.configuration) {
    lines.push(`  Configuration: ${params.configuration}`);
  }
  if (params.platform) {
    lines.push(`  Platform: ${params.platform}`);
  }

  if (params.simulatorName) {
    lines.push(`  Simulator: ${params.simulatorName}`);
  } else if (params.simulatorId) {
    lines.push(`  Simulator: ${params.simulatorId}`);
  }

  if (params.deviceId) {
    lines.push(`  Device: ${params.deviceId}`);
  }

  if (params.arch) {
    lines.push(`  Architecture: ${params.arch}`);
  }

  lines.push('');

  return lines.join('\n');
}
