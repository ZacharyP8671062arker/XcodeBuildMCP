import type { PipelineEvent } from '../../types/pipeline-events.ts';
import type { PipelineRenderer } from './index.ts';

export function createCliJsonlRenderer(): PipelineRenderer {
  return {
    onEvent(event: PipelineEvent): void {
      process.stdout.write(JSON.stringify(event) + '\n');
    },
    finalize(): void {
      // no-op
    },
  };
}
