import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/command.ts';
import { activeProcesses } from './active-processes.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, table } from '../../../utils/tool-event-builders.ts';

/**
 * Process list dependencies for dependency injection
 */
type ListProcessInfo = {
  executableName?: string;
  packagePath?: string;
  startedAt: Date;
};

export interface ProcessListDependencies {
  processMap?: Map<number, ListProcessInfo>;
  arrayFrom?: typeof Array.from;
  dateNow?: typeof Date.now;
}

/**
 * Swift package list business logic - extracted for testability and separation of concerns
 * @param params - Parameters (unused, but maintained for consistency)
 * @param dependencies - Injectable dependencies for testing
 * @returns ToolResponse with process list information
 */
export async function swift_package_listLogic(
  params?: unknown,
  dependencies?: ProcessListDependencies,
): Promise<ToolResponse> {
  const processMap =
    dependencies?.processMap ??
    new Map<number, ListProcessInfo>(
      Array.from(activeProcesses.entries()).map(([pid, info]) => [
        pid,
        {
          executableName: info.executableName,
          packagePath: info.packagePath,
          startedAt: info.startedAt,
        },
      ]),
    );
  const arrayFrom = dependencies?.arrayFrom ?? Array.from;
  const dateNow = dependencies?.dateNow ?? Date.now;

  const processes = arrayFrom(processMap.entries());

  const headerEvent = header('Swift Package List');

  if (processes.length === 0) {
    return toolResponse([
      headerEvent,
      statusLine('info', 'No Swift Package processes currently running.'),
    ]);
  }

  const rows = processes.map(([pid, info]: [number, ListProcessInfo]) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const executableName = info.executableName || 'default';
    const runtime = Math.max(1, Math.round((dateNow() - info.startedAt.getTime()) / 1000));
    const packagePath = info.packagePath ?? 'unknown package';
    return {
      PID: String(pid),
      Executable: executableName,
      Package: packagePath,
      Runtime: `${runtime}s`,
    };
  });

  return toolResponse([
    headerEvent,
    table(
      ['PID', 'Executable', 'Package', 'Runtime'],
      rows,
      `Active Processes (${processes.length})`,
    ),
    statusLine('success', `${processes.length} process(es) running`),
  ]);
}

const swiftPackageListSchema = z.object({});

type SwiftPackageListParams = z.infer<typeof swiftPackageListSchema>;

export const schema = swiftPackageListSchema.shape;

export const handler = createTypedTool(
  swiftPackageListSchema,
  (params: SwiftPackageListParams) => {
    return swift_package_listLogic(params);
  },
  getDefaultCommandExecutor,
);
