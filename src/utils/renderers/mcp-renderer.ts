import type { XcodebuildEvent } from '../../types/xcodebuild-events.ts';
import type { ToolResponseContent } from '../../types/common.ts';
import { sessionStore } from '../session-store.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { XcodebuildRenderer } from './index.ts';
import {
  formatStartEvent,
  formatStatusEvent,
  formatNoticeEvent,
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
  const groupedCompilerErrors: Extract<XcodebuildEvent, { type: 'error' }>[] = [];
  const groupedWarnings: Extract<XcodebuildEvent, { type: 'warning' }>[] = [];
  let diagnosticBaseDir: string | null = null;

  function pushText(text: string): void {
    content.push({ type: 'text', text });
  }

  function pushSection(text: string): void {
    pushText(`\n${text}`);
  }

  return {
    onEvent(event: XcodebuildEvent): void {
      switch (event.type) {
        case 'start': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          pushSection(formatStartEvent(event));
          break;
        }

        case 'status': {
          pushText(formatStatusEvent(event));
          break;
        }

        case 'notice': {
          pushText(formatNoticeEvent(event));
          break;
        }

        case 'warning': {
          if (suppressWarnings) {
            return;
          }
          groupedWarnings.push(event);
          break;
        }

        case 'error': {
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
