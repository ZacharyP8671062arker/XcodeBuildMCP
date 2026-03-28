import { describe, it, beforeAll, afterAll } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('utilities workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;

  beforeAll(() => {
    harness = createFlowdeckHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('clean', () => {
    it('success', () => {
      const result = harness.run([
        'clean', '-w', WORKSPACE, '-s', 'CalculatorApp',
      ]);
      writeFlowdeckFixture(__filename, 'clean--success', result.text);
    }, 120000);

    it('error - wrong scheme', () => {
      const result = harness.run([
        'clean', '-w', WORKSPACE, '-s', 'NONEXISTENT',
      ]);
      writeFlowdeckFixture(__filename, 'clean--error-wrong-scheme', result.text);
    }, 120000);
  });
});
