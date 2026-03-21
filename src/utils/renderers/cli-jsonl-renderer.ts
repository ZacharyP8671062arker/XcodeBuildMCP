import type { XcodebuildEvent } from '../../types/xcodebuild-events.ts';
import type { XcodebuildRenderer } from './index.ts';

export function createCliJsonlRenderer(): XcodebuildRenderer {
  return {
    onEvent(event: XcodebuildEvent): void {
      process.stdout.write(JSON.stringify(event) + '\n');
    },
    finalize(): void {
      // no-op
    },
  };
}
