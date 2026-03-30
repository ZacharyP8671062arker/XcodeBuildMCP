import { describe, it, beforeAll, afterAll } from 'vitest';
import { createFlowdeckHarness } from '../flowdeck-harness.ts';
import { writeFlowdeckFixture } from '../flowdeck-fixture-io.ts';
import type { FlowdeckHarness } from '../flowdeck-harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('project-discovery workflow (flowdeck)', () => {
  let harness: FlowdeckHarness;

  beforeAll(() => {
    harness = createFlowdeckHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('list-schemes', () => {
    it('success', () => {
      const result = harness.run(['project', 'schemes', '-w', WORKSPACE]);
      writeFlowdeckFixture(__filename, 'list-schemes--success', result.text);
    });

    it('error - invalid workspace', () => {
      const result = harness.run([
        'project',
        'schemes',
        '-w',
        '/nonexistent/path/Fake.xcworkspace',
      ]);
      writeFlowdeckFixture(__filename, 'list-schemes--error-invalid-workspace', result.text);
    });
  });

  describe('show-build-settings', () => {
    // flowdeck doesn't have a direct show-build-settings command
    // The closest is `flowdeck project configs` which lists build configurations
    it('success (configs)', () => {
      const result = harness.run(['project', 'configs', '-w', WORKSPACE]);
      writeFlowdeckFixture(__filename, 'show-build-settings--success', result.text);
    });
  });

  describe('discover-projs', () => {
    // flowdeck doesn't have a direct discover-projects command
    // project schemes is the closest for discovery
    it.skip('no direct flowdeck equivalent', () => {});
  });

  describe('get-app-bundle-id', () => {
    // flowdeck doesn't expose bundle ID extraction
    it.skip('no direct flowdeck equivalent', () => {});
  });

  describe('get-macos-bundle-id', () => {
    // flowdeck doesn't expose bundle ID extraction
    it.skip('no direct flowdeck equivalent', () => {});
  });
});
