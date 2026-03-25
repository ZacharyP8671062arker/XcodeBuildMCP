import * as z from 'zod';
import path from 'node:path';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  targetName: z.string().optional(),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  architectures: z.array(z.string()).optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageBuildSchema = baseSchemaObject;

type SwiftPackageBuildParams = z.infer<typeof swiftPackageBuildSchema>;

export async function swift_package_buildLogic(
  params: SwiftPackageBuildParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['build', '--package-path', resolvedPath];

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  }

  if (params.targetName) {
    swiftArgs.push('--target', params.targetName);
  }

  if (params.architectures) {
    for (const arch of params.architectures) {
      swiftArgs.push('--arch', arch);
    }
  }

  if (params.parseAsLibrary) {
    swiftArgs.push('-Xswiftc', '-parse-as-library');
  }

  log('info', `Running swift ${swiftArgs.join(' ')}`);

  const headerEvent = header('Swift Package Build', [
    { label: 'Package', value: resolvedPath },
    ...(params.targetName ? [{ label: 'Target', value: params.targetName }] : []),
    ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
  ]);

  try {
    const result = await executor(['swift', ...swiftArgs], 'Swift Package Build', false);
    if (!result.success) {
      const errorMessage = result.error || result.output || 'Unknown error';
      return toolResponse([
        headerEvent,
        statusLine('error', `Swift package build failed: ${errorMessage}`),
      ]);
    }

    return toolResponse([
      headerEvent,
      ...(result.output ? [section('Output', [result.output])] : []),
      statusLine('success', 'Swift package build succeeded'),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Swift package build failed: ${message}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to execute swift build: ${message}`),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageBuildParams>({
  internalSchema: swiftPackageBuildSchema,
  logicFunction: swift_package_buildLogic,
  getExecutor: getDefaultCommandExecutor,
});
