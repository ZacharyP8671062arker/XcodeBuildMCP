import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  PipelineEvent,
} from '../../types/pipeline-events.ts';
import type { ToolResponseContent } from '../../types/common.ts';
import { sessionStore } from '../session-store.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { XcodebuildRenderer } from './index.ts';
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
  formatTestFailureEvent,
  formatTestDiscoveryEvent,
  formatSummaryEvent,
  formatNextStepsEvent,
} from './event-formatting.ts';

export function createMcpRenderer(): XcodebuildRenderer & {
  getContent(): ToolResponseContent[];
} {
  const content: ToolResponseContent[] = [];
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  let diagnosticBaseDir: string | null = null;

  function pushText(text: string): void {
    content.push({ type: 'text', text });
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
          pushText(formatBuildStageEvent(event));
          break;
        }

        case 'status-line': {
          pushText(formatStatusLineEvent(event));
          break;
        }

        case 'section': {
          pushSection(formatSectionEvent(event));
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
          pushText(formatFileRefEvent(event));
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
          pushText(formatTestFailureEvent(event, { baseDir: diagnosticBaseDir ?? undefined }));
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
      return [...content];
    },
  };
}
