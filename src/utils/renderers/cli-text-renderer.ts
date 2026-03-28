import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  TestFailureEvent,
  PipelineEvent,
} from '../../types/pipeline-events.ts';
import { createCliProgressReporter } from '../cli-progress-reporter.ts';
import { formatCliTextLine } from '../terminal-output.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { XcodebuildRenderer } from './index.ts';
import {
  formatHeaderEvent,
  formatBuildStageEvent,
  formatTransientBuildStageEvent,
  formatStatusLineEvent,
  formatTransientStatusLineEvent,
  formatSectionEvent,
  formatDetailTreeEvent,
  formatTableEvent,
  formatFileRefEvent,
  formatGroupedCompilerErrors,
  formatGroupedWarnings,
  formatGroupedTestFailures,
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
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  const groupedTestFailures: TestFailureEvent[] = [];
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
    if (pendingTransientRuntimeLine) {
      writeDurable(pendingTransientRuntimeLine);
    }
  }

  return {
    onEvent(event: PipelineEvent): void {
      switch (event.type) {
        case 'header': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          hasDurableRuntimeContent = false;
          writeSection(formatHeaderEvent(event));
          break;
        }

        case 'build-stage': {
          if (interactive) {
            pendingTransientRuntimeLine = formatBuildStageEvent(event);
            reporter.update(formatTransientBuildStageEvent(event));
          } else {
            writeDurable(formatBuildStageEvent(event));
          }
          break;
        }

        case 'status-line': {
          const transient = interactive ? formatTransientStatusLineEvent(event) : null;
          if (transient) {
            pendingTransientRuntimeLine = formatStatusLineEvent(event);
            reporter.update(transient);
            break;
          }

          writeSection(formatStatusLineEvent(event));
          break;
        }

        case 'section': {
          writeSection(formatSectionEvent(event));
          break;
        }

        case 'detail-tree': {
          writeSection(formatDetailTreeEvent(event));
          break;
        }

        case 'table': {
          writeSection(formatTableEvent(event));
          break;
        }

        case 'file-ref': {
          writeSection(formatFileRefEvent(event));
          break;
        }

        case 'compiler-warning': {
          groupedWarnings.push(event);
          break;
        }

        case 'compiler-error': {
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
          groupedTestFailures.push(event);
          break;
        }

        case 'summary': {
          const diagOpts = { baseDir: diagnosticBaseDir ?? undefined };
          const diagnosticSections: string[] = [];

          if (groupedTestFailures.length > 0) {
            diagnosticSections.push(formatGroupedTestFailures(groupedTestFailures, diagOpts));
            groupedTestFailures.length = 0;
          }

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
