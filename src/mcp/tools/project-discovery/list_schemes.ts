import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
});

const listSchemesSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type ListSchemesParams = z.infer<typeof listSchemesSchema>;

export function parseSchemesFromXcodebuildListOutput(output: string): string[] {
  const schemesMatch = output.match(/Schemes:([\s\S]*?)(?=\n\n|$)/);
  if (!schemesMatch) {
    throw new Error('No schemes found in the output');
  }

  return schemesMatch[1]
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function listSchemes(
  params: ListSchemesParams,
  executor: CommandExecutor,
): Promise<string[]> {
  const command = ['xcodebuild', '-list'];

  if (typeof params.projectPath === 'string') {
    command.push('-project', params.projectPath);
  } else {
    command.push('-workspace', params.workspacePath!);
  }

  const result = await executor(command, 'List Schemes', false);
  if (!result.success) {
    throw new Error(`Failed to list schemes: ${result.error}`);
  }

  return parseSchemesFromXcodebuildListOutput(result.output);
}

export async function listSchemesLogic(
  params: ListSchemesParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  log('info', 'Listing schemes');

  const hasProjectPath = typeof params.projectPath === 'string';
  const projectOrWorkspace = hasProjectPath ? 'project' : 'workspace';
  const pathValue = hasProjectPath ? params.projectPath : params.workspacePath;

  const headerEvent = header(
    'List Schemes',
    hasProjectPath
      ? [{ label: 'Project', value: pathValue! }]
      : [{ label: 'Workspace', value: pathValue! }],
  );

  try {
    const schemes = await listSchemes(params, executor);

    let nextStepParams: Record<string, Record<string, string | number | boolean>> | undefined;

    if (schemes.length > 0) {
      const firstScheme = schemes[0];

      nextStepParams = {
        build_macos: { [`${projectOrWorkspace}Path`]: pathValue!, scheme: firstScheme },
        build_run_sim: {
          [`${projectOrWorkspace}Path`]: pathValue!,
          scheme: firstScheme,
          simulatorName: 'iPhone 17',
        },
        build_sim: {
          [`${projectOrWorkspace}Path`]: pathValue!,
          scheme: firstScheme,
          simulatorName: 'iPhone 17',
        },
        show_build_settings: { [`${projectOrWorkspace}Path`]: pathValue!, scheme: firstScheme },
      };
    }

    const schemeItems = schemes.length > 0 ? schemes : ['(none)'];
    const schemeWord = schemes.length === 1 ? 'scheme' : 'schemes';

    return toolResponse(
      [
        headerEvent,
        statusLine('success', `Found ${schemes.length} ${schemeWord}`),
        section('Schemes:', schemeItems),
      ],
      nextStepParams ? { nextStepParams } : undefined,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error listing schemes: ${errorMessage}`);

    const rawError = errorMessage.startsWith('Failed to list schemes: ')
      ? errorMessage.slice('Failed to list schemes: '.length)
      : errorMessage;

    return toolResponse([headerEvent, statusLine('error', rawError)]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: baseSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<ListSchemesParams>({
  internalSchema: listSchemesSchema as unknown as z.ZodType<ListSchemesParams, unknown>,
  logicFunction: listSchemesLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
