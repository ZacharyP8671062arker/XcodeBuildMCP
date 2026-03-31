import * as z from 'zod';
import path from 'node:path';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const swiftPackageCleanSchema = z.object({
  packagePath: z.string(),
});

type SwiftPackageCleanParams = z.infer<typeof swiftPackageCleanSchema>;

export async function swift_package_cleanLogic(
  params: SwiftPackageCleanParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const resolvedPath = path.resolve(params.packagePath);
  const swiftArgs = ['package', '--package-path', resolvedPath, 'clean'];

  log('info', `Running swift ${swiftArgs.join(' ')}`);

  const headerEvent = header('Swift Package Clean', [{ label: 'Package', value: resolvedPath }]);

  return withErrorHandling(
    async () => {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Clean', false);
      if (!result.success) {
        const errorMessage = result.error || result.output || 'Unknown error';
        return toolResponse([
          headerEvent,
          statusLine('error', `Swift package clean failed: ${errorMessage}`),
        ]);
      }

      return toolResponse([
        headerEvent,
        ...(result.output ? [section('Output', [result.output])] : []),
        statusLine('success', 'Swift package cleaned successfully'),
      ]);
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to execute swift package clean: ${message}`,
      logMessage: ({ message }) => `Swift package clean failed: ${message}`,
    },
  );
}

export const schema = swiftPackageCleanSchema.shape;

export const handler = createTypedTool(
  swiftPackageCleanSchema,
  swift_package_cleanLogic,
  getDefaultCommandExecutor,
);
