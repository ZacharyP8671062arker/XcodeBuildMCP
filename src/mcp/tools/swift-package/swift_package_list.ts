import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/command.ts';
import { activeProcesses } from './active-processes.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

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

  const headerEvent = header('Swift Package Processes');

  if (processes.length === 0) {
    return toolResponse([
      headerEvent,
      statusLine('info', 'No Swift Package processes currently running.'),
    ]);
  }

  const events: PipelineEvent[] = [headerEvent];

  const cardLines: string[] = [''];
  for (const [pid, info] of processes as Array<[number, ListProcessInfo]>) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const executableName = info.executableName || 'default';
    const runtime = Math.max(1, Math.round((dateNow() - info.startedAt.getTime()) / 1000));
    const packagePath = info.packagePath ?? 'unknown package';
    cardLines.push(
      `\u{1F7E2} ${executableName}`,
      `   PID: ${pid} | Uptime: ${runtime}s`,
      `   Package: ${packagePath}`,
      '',
    );
  }

  while (cardLines.at(-1) === '') {
    cardLines.pop();
  }

  events.push(section(`Running Processes (${processes.length}):`, cardLines));

  return toolResponse(events);
}

const swiftPackageListSchema = z.object({});

type SwiftPackageListParams = z.infer<typeof swiftPackageListSchema>;

export const schema = swiftPackageListSchema.shape;

export const handler = createTypedTool(
  swiftPackageListSchema,
  (params: SwiftPackageListParams) => swift_package_listLogic(params),
  getDefaultCommandExecutor,
);
