import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  TestFailureEvent,
  PipelineEvent,
} from '../../types/pipeline-events.ts';
import type { ToolResponseContent } from '../../types/common.ts';
import { sessionStore } from '../session-store.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { PipelineRenderer } from './index.ts';
import {
  formatHeaderEvent,
  formatBuildStageEvent,
  formatStatusLineEvent,
  formatSectionEvent,
  formatDetailTreeEvent,
  formatTableEvent,
  formatFileRefEvent,
  formatGroupedCompilerErrors,
  formatGroupedWarnings,
  formatGroupedTestFailures,
  formatTestDiscoveryEvent,
  formatSummaryEvent,
  formatNextStepsEvent,
} from './event-formatting.ts';

export function createMcpRenderer(): PipelineRenderer & {
  getContent(): ToolResponseContent[];
} {
  const contentParts: string[] = [];
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  const groupedTestFailures: TestFailureEvent[] = [];
  let diagnosticBaseDir: string | null = null;

  function pushText(text: string): void {
    contentParts.push(text);
  }

  function pushSection(text: string): void {
    pushText(`\n${text}`);
  }

  return {
    onEvent(event: PipelineEvent): void {
      switch (event.type) {
        case 'header': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          pushSection(formatHeaderEvent(event));
          break;
        }

        case 'build-stage': {
          pushSection(formatBuildStageEvent(event));
          break;
        }

        case 'status-line': {
          pushSection(formatStatusLineEvent(event));
          break;
        }

        case 'section': {
          pushText(`\n\n${formatSectionEvent(event)}`);
          break;
        }

        case 'detail-tree': {
          pushSection(formatDetailTreeEvent(event));
          break;
        }

        case 'table': {
          pushSection(formatTableEvent(event));
          break;
        }

        case 'file-ref': {
          pushSection(formatFileRefEvent(event));
          break;
        }

        case 'compiler-warning': {
          if (suppressWarnings) {
            return;
          }
          groupedWarnings.push(event);
          break;
        }

        case 'compiler-error': {
          groupedCompilerErrors.push(event);
          break;
        }

        case 'test-discovery': {
          pushText(formatTestDiscoveryEvent(event));
          break;
        }

        case 'test-progress': {
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
            pushSection(diagnosticSections.join('\n\n'));
          }

          pushSection(formatSummaryEvent(event));
          break;
        }

        case 'next-steps': {
          pushSection(formatNextStepsEvent(event, 'mcp'));
          break;
        }
      }
    },

    finalize(): void {
      diagnosticBaseDir = null;
    },

    getContent(): ToolResponseContent[] {
      if (contentParts.length === 0) {
        return [];
      }

      return [{ type: 'text', text: contentParts.join('') }];
    },
  };
}
