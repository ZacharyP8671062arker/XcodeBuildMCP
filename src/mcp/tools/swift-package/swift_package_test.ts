import * as z from 'zod';
import path from 'node:path';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  testProduct: z.string().optional(),
  filter: z.string().optional().describe('regex: pattern'),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  parallel: z.boolean().optional(),
  showCodecov: z.boolean().optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageTestSchema = baseSchemaObject;

type SwiftPackageTestParams = z.infer<typeof swiftPackageTestSchema>;

export async function swift_package_testLogic(
  params: SwiftPackageTestParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['test', '--package-path', resolvedPath];

  const headerEvent = header('Swift Package Test', [
    { label: 'Package', value: resolvedPath },
    ...(params.testProduct ? [{ label: 'Test Product', value: params.testProduct }] : []),
    ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
  ]);

  if (params.configuration?.toLowerCase() === 'release') {
    swiftArgs.push('-c', 'release');
  } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
    return toolResponse([
      headerEvent,
      statusLine('error', "Invalid configuration. Use 'debug' or 'release'."),
    ]);
  }

  if (params.testProduct) {
    swiftArgs.push('--test-product', params.testProduct);
  }

  if (params.filter) {
    swiftArgs.push('--filter', params.filter);
  }

  if (params.parallel === false) {
    swiftArgs.push('--no-parallel');
  }

  if (params.showCodecov) {
    swiftArgs.push('--show-code-coverage');
  }

  if (params.parseAsLibrary) {
    swiftArgs.push('-Xswiftc', '-parse-as-library');
  }

  log('info', `Running swift ${swiftArgs.join(' ')}`);
  try {
    const result = await executor(['swift', ...swiftArgs], 'Swift Package Test', false);
    if (!result.success) {
      const errorMessage = result.error || result.output || 'Unknown error';
      return toolResponse([
        headerEvent,
        statusLine('error', `Swift package tests failed: ${errorMessage}`),
      ]);
    }

    return toolResponse([
      headerEvent,
      ...(result.output ? [section('Output', [result.output])] : []),
      statusLine('success', 'Swift package tests completed'),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Swift package test failed: ${message}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to execute swift test: ${message}`),
    ]);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageTestParams>({
  internalSchema: swiftPackageTestSchema,
  logicFunction: swift_package_testLogic,
  getExecutor: getDefaultCommandExecutor,
});
