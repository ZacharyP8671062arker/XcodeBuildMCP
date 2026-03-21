import type { XcodebuildEvent } from '../../types/xcodebuild-events.ts';
import { createCliProgressReporter } from '../cli-progress-reporter.ts';
import { formatCliTextLine } from '../terminal-output.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { XcodebuildRenderer } from './index.ts';
import {
  formatStartEvent,
  formatStatusEvent,
  formatTransientStatusEvent,
  formatNoticeEvent,
  formatTransientNoticeEvent,
  formatGroupedCompilerErrors,
  formatGroupedWarnings,
  formatTestFailureEvent,
  formatSummaryEvent,
  formatNextStepsEvent,
} from './event-formatting.ts';

function formatCliTextBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => formatCliTextLine(line))
    .join('\n');
}

export function createCliTextRenderer(options: { interactive: boolean }): XcodebuildRenderer {
  const { interactive } = options;
  const reporter = createCliProgressReporter();
  const groupedCompilerErrors: Extract<XcodebuildEvent, { type: 'error' }>[] = [];
  const groupedWarnings: Extract<XcodebuildEvent, { type: 'warning' }>[] = [];
  let pendingTransientRuntimeLine: string | null = null;
  let diagnosticBaseDir: string | null = null;
  let hasDurableRuntimeContent = false;

  function writeDurable(text: string): void {
    reporter.clear();
    pendingTransientRuntimeLine = null;
    hasDurableRuntimeContent = true;
    process.stdout.write(`${formatCliTextBlock(text)}\n`);
  }

  function writeSection(text: string): void {
    reporter.clear();
    pendingTransientRuntimeLine = null;
    process.stdout.write(`\n${formatCliTextBlock(text)}\n`);
  }

  function flushPendingTransientRuntimeLine(): void {
    if (!pendingTransientRuntimeLine) {
      return;
    }

    const line = pendingTransientRuntimeLine;
    writeDurable(line);
  }

  return {
    onEvent(event: XcodebuildEvent): void {
      switch (event.type) {
        case 'start': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          hasDurableRuntimeContent = false;
          writeSection(formatStartEvent(event));
          break;
        }

        case 'status': {
          if (interactive) {
            pendingTransientRuntimeLine = formatStatusEvent(event);
            reporter.update(formatTransientStatusEvent(event));
          } else {
            writeDurable(formatStatusEvent(event));
          }
          break;
        }

        case 'notice': {
          const transientNotice = interactive ? formatTransientNoticeEvent(event) : null;
          if (transientNotice) {
            pendingTransientRuntimeLine = formatNoticeEvent(event);
            reporter.update(transientNotice);
            break;
          }

          writeDurable(formatNoticeEvent(event));
          break;
        }

        case 'warning': {
          groupedWarnings.push(event);
          break;
        }

        case 'error': {
          groupedCompilerErrors.push(event);
          break;
        }

        case 'test-discovery': {
          break;
        }

        case 'test-progress': {
          const failWord = event.failed === 1 ? 'failure' : 'failures';
          if (interactive) {
            pendingTransientRuntimeLine = null;
            reporter.update(`Running tests (${event.completed}, ${event.failed} ${failWord})`);
          }
          break;
        }

        case 'test-failure': {
          flushPendingTransientRuntimeLine();
          writeDurable(formatTestFailureEvent(event, { baseDir: diagnosticBaseDir ?? undefined }));
          break;
        }

        case 'summary': {
          const diagOpts = { baseDir: diagnosticBaseDir ?? undefined };
          const diagnosticSections: string[] = [];

          if (groupedWarnings.length > 0) {
            diagnosticSections.push(formatGroupedWarnings(groupedWarnings, diagOpts));
            groupedWarnings.length = 0;
          }

          if (event.status === 'FAILED' && groupedCompilerErrors.length > 0) {
            diagnosticSections.push(formatGroupedCompilerErrors(groupedCompilerErrors, diagOpts));
            groupedCompilerErrors.length = 0;
          }

          if (diagnosticSections.length > 0) {
            const diagnosticsBlock = diagnosticSections.join('\n\n');
            if (pendingTransientRuntimeLine) {
              writeSection(`${pendingTransientRuntimeLine}\n\n${diagnosticsBlock}`);
              pendingTransientRuntimeLine = null;
            } else if (hasDurableRuntimeContent) {
              writeSection(diagnosticsBlock);
            } else {
              writeDurable(diagnosticsBlock);
            }
          } else if (event.status === 'FAILED') {
            flushPendingTransientRuntimeLine();
          }

          writeSection(formatSummaryEvent(event));
          break;
        }

        case 'next-steps': {
          writeSection(formatNextStepsEvent(event, 'cli'));
          break;
        }
      }
    },

    finalize(): void {
      reporter.clear();
      pendingTransientRuntimeLine = null;
      diagnosticBaseDir = null;
      hasDurableRuntimeContent = false;
    },
  };
}
