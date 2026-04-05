import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  PipelineEvent,
  TestFailureEvent,
} from '../types/pipeline-events.ts';
import { sessionStore } from '../utils/session-store.ts';
import { deriveDiagnosticBaseDir } from '../utils/renderers/index.ts';
import {
  formatBuildStageEvent,
  formatDetailTreeEvent,
  formatFileRefEvent,
  formatGroupedCompilerErrors,
  formatGroupedTestFailures,
  formatGroupedWarnings,
  formatHeaderEvent,
  formatNextStepsEvent,
  formatSectionEvent,
  formatStatusLineEvent,
  formatSummaryEvent,
  formatTableEvent,
  formatTestDiscoveryEvent,
  formatTransientBuildStageEvent,
  formatTransientStatusLineEvent,
} from '../utils/renderers/event-formatting.ts';
import type { RenderSession, RenderStrategy, TextRenderOp, ImageAttachment } from './types.ts';

function createTextRenderSession(): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  const contentParts: string[] = [];
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  const groupedTestFailures: TestFailureEvent[] = [];

  let diagnosticBaseDir: string | null = null;
  let hasError = false;

  const pushText = (text: string): void => {
    contentParts.push(text);
  };

  const pushSection = (text: string): void => {
    pushText(`\n${text}`);
  };

  const markErrorIfNeeded = (event: PipelineEvent): void => {
    if (
      (event.type === 'status-line' && event.level === 'error') ||
      (event.type === 'summary' && event.status === 'FAILED')
    ) {
      hasError = true;
    }
  };

  return {
    emit(event: PipelineEvent): TextRenderOp | null {
      events.push(event);
      markErrorIfNeeded(event);

      switch (event.type) {
        case 'header': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          pushSection(formatHeaderEvent(event));
          return { text: formatHeaderEvent(event) };
        }

        case 'build-stage': {
          const text = formatBuildStageEvent(event);
          pushSection(text);
          return { text: formatTransientBuildStageEvent(event), transient: true };
        }

        case 'status-line': {
          const text = formatStatusLineEvent(event);
          pushSection(text);
          if (event.level === 'info') {
            return {
              text: formatTransientStatusLineEvent(event) ?? `${event.message}...`,
              transient: true,
            };
          }
          return { text };
        }

        case 'section': {
          const text = formatSectionEvent(event);
          pushText(`\n\n${text}`);
          return { text };
        }

        case 'detail-tree': {
          const text = formatDetailTreeEvent(event);
          pushSection(text);
          return { text };
        }

        case 'table': {
          const text = formatTableEvent(event);
          pushSection(text);
          return { text };
        }

        case 'file-ref': {
          const text = formatFileRefEvent(event);
          pushSection(text);
          return { text };
        }

        case 'compiler-warning': {
          if (!suppressWarnings) {
            groupedWarnings.push(event);
          }
          return null;
        }

        case 'compiler-error': {
          groupedCompilerErrors.push(event);
          return null;
        }

        case 'test-discovery': {
          const text = formatTestDiscoveryEvent(event);
          pushText(text);
          return { text };
        }

        case 'test-progress': {
          return null;
        }

        case 'test-failure': {
          groupedTestFailures.push(event);
          return null;
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

          const text = formatSummaryEvent(event);
          pushSection(text);
          return { text };
        }

        case 'next-steps': {
          const text = formatNextStepsEvent(event, 'mcp');
          pushSection(text);
          return { text };
        }
      }
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    getEvents(): readonly PipelineEvent[] {
      return events;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      diagnosticBaseDir = null;
      return contentParts.join('');
    },
  };
}

function createJsonRenderSession(): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  const lines: string[] = [];
  let hasError = false;

  return {
    emit(event: PipelineEvent): TextRenderOp {
      events.push(event);
      if (
        (event.type === 'status-line' && event.level === 'error') ||
        (event.type === 'summary' && event.status === 'FAILED')
      ) {
        hasError = true;
      }

      const text = JSON.stringify(event);
      lines.push(text);
      return { text };
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    getEvents(): readonly PipelineEvent[] {
      return events;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      return lines.join('\n');
    },
  };
}

export function createRenderSession(strategy: RenderStrategy): RenderSession {
  return strategy === 'json' ? createJsonRenderSession() : createTextRenderSession();
}

export function renderEvents(events: readonly PipelineEvent[], strategy: RenderStrategy): string {
  const session = createRenderSession(strategy);
  for (const event of events) {
    session.emit(event);
  }
  return session.finalize();
}
