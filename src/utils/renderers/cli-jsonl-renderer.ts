import type { PipelineEvent } from '../../types/pipeline-events.ts';
import type { XcodebuildRenderer } from './index.ts';

export function createCliJsonlRenderer(): XcodebuildRenderer {
  return {
    onEvent(event: PipelineEvent): void {
      process.stdout.write(JSON.stringify(event) + '\n');
    },
    finalize(): void {
      // no-op
    },
  };
}
