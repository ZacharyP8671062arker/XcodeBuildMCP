import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  areAxeToolsAvailable,
  isAxeAtLeastVersion,
  AXE_NOT_AVAILABLE_MESSAGE,
} from '../../../utils/axe/index.ts';
import {
  startSimulatorVideoCapture,
  stopSimulatorVideoCapture,
} from '../../../utils/video-capture/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { dirname } from 'path';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';

// Base schema object (used for MCP schema exposure)
const recordSimVideoSchemaObject = z.object({
  simulatorId: z
    .uuid({ message: 'Invalid Simulator UUID format' })
    .describe('UUID of the simulator to record'),
  start: z.boolean().optional(),
  stop: z.boolean().optional(),
  fps: z.number().int().min(1).max(120).optional().describe('default: 30'),
  outputFile: z.string().optional().describe('Path to write MP4 file'),
});

// Schema enforcing mutually exclusive start/stop and requiring outputFile on stop
const recordSimVideoSchema = recordSimVideoSchemaObject
  .refine(
    (v) => {
      const s = v.start === true ? 1 : 0;
      const t = v.stop === true ? 1 : 0;
      return s + t === 1;
    },
    {
      message:
        'Provide exactly one of start=true or stop=true; these options are mutually exclusive',
      path: ['start'],
    },
  )
  .refine((v) => (v.stop ? typeof v.outputFile === 'string' && v.outputFile.length > 0 : true), {
    message: 'outputFile is required when stop=true',
    path: ['outputFile'],
  });

type RecordSimVideoParams = z.infer<typeof recordSimVideoSchema>;

export async function record_sim_videoLogic(
  params: RecordSimVideoParams,
  executor: CommandExecutor,
  axe: {
    areAxeToolsAvailable(): boolean;
    isAxeAtLeastVersion(v: string, e: CommandExecutor): Promise<boolean>;
  } = {
    areAxeToolsAvailable,
    isAxeAtLeastVersion,
  },
  video: {
    startSimulatorVideoCapture: typeof startSimulatorVideoCapture;
    stopSimulatorVideoCapture: typeof stopSimulatorVideoCapture;
  } = {
    startSimulatorVideoCapture,
    stopSimulatorVideoCapture,
  },
  fs: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  const headerEvent = header('Record Video', [{ label: 'Simulator', value: params.simulatorId }]);

  if (!axe.areAxeToolsAvailable()) {
    return toolResponse([headerEvent, statusLine('error', AXE_NOT_AVAILABLE_MESSAGE)]);
  }
  const hasVersion = await axe.isAxeAtLeastVersion('1.1.0', executor);
  if (!hasVersion) {
    return toolResponse([
      headerEvent,
      statusLine(
        'error',
        'AXe v1.1.0 or newer is required for simulator video capture. Please update bundled AXe artifacts.',
      ),
    ]);
  }

  if (params.start) {
    const fpsUsed = params.fps ?? 30;
    const startRes = await video.startSimulatorVideoCapture(
      { simulatorUuid: params.simulatorId, fps: fpsUsed },
      executor,
    );

    if (!startRes.started) {
      return toolResponse([
        headerEvent,
        statusLine(
          'error',
          `Failed to start video recording: ${startRes.error ?? 'Unknown error'}`,
        ),
      ]);
    }

    const notes: string[] = [];
    if (typeof params.outputFile === 'string' && params.outputFile.length > 0) {
      notes.push(
        'Note: outputFile is ignored when start=true; provide it when stopping to move/rename the recorded file.',
      );
    }
    if (startRes.warning) {
      notes.push(startRes.warning);
    }

    const events = [
      headerEvent,
      detailTree([
        { label: 'FPS', value: String(fpsUsed) },
        { label: 'Session', value: startRes.sessionId },
      ]),
      ...(notes.length > 0 ? [section('Notes', notes)] : []),
      statusLine(
        'success',
        `Video recording started for simulator ${params.simulatorId} at ${fpsUsed} fps`,
      ),
    ];

    return toolResponse(events, {
      nextStepParams: {
        record_sim_video: {
          simulatorId: params.simulatorId,
          stop: true,
          outputFile: '/path/to/output.mp4',
        },
      },
    });
  }

  // params.stop must be true here per schema
  const stopRes = await video.stopSimulatorVideoCapture(
    { simulatorUuid: params.simulatorId },
    executor,
  );

  if (!stopRes.stopped) {
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to stop video recording: ${stopRes.error ?? 'Unknown error'}`),
    ]);
  }

  const outputs: string[] = [];
  let finalSavedPath = params.outputFile ?? stopRes.parsedPath ?? '';
  try {
    if (params.outputFile) {
      if (!stopRes.parsedPath) {
        return toolResponse([
          headerEvent,
          statusLine(
            'error',
            `Recording stopped but could not determine the recorded file path from AXe output. Raw output: ${stopRes.stdout ?? '(no output captured)'}`,
          ),
        ]);
      }

      const src = stopRes.parsedPath;
      const dest = params.outputFile;
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.cp(src, dest);
      try {
        await fs.rm(src, { recursive: false });
      } catch {
        // Ignore cleanup failure
      }
      finalSavedPath = dest;

      outputs.push(`Original file: ${src}`);
      outputs.push(`Saved to: ${dest}`);
    } else if (stopRes.parsedPath) {
      outputs.push(`Saved to: ${stopRes.parsedPath}`);
      finalSavedPath = stopRes.parsedPath;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return toolResponse([
      headerEvent,
      statusLine('error', `Recording stopped but failed to save/move the video file: ${msg}`),
    ]);
  }

  const stopEvents = [
    headerEvent,
    ...(outputs.length > 0 ? [section('Output', outputs)] : []),
    ...(!outputs.length && stopRes.stdout ? [section('AXe Output', [stopRes.stdout])] : []),
    statusLine('success', `Video recording stopped for simulator ${params.simulatorId}`),
  ];

  const response = toolResponse(stopEvents);
  if (finalSavedPath) {
    (response as Record<string, unknown>)._meta = { outputFile: finalSavedPath };
  }
  return response;
}

const publicSchemaObject = z.strictObject(
  recordSimVideoSchemaObject.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: recordSimVideoSchemaObject,
});

export const handler = createSessionAwareTool<RecordSimVideoParams>({
  internalSchema: recordSimVideoSchema as unknown as z.ZodType<RecordSimVideoParams, unknown>,
  logicFunction: record_sim_videoLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
