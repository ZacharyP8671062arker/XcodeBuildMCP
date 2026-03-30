import { describe, it, expect } from 'vitest';
import {
  toolManifestEntrySchema,
  workflowManifestEntrySchema,
  deriveCliName,
  getEffectiveCliName,
  type ToolManifestEntry,
} from '../schema.ts';

describe('schema', () => {
  it('parses a representative manifest/tool naming pipeline', () => {
    const toolInput = {
      id: 'build_sim',
      module: 'mcp/tools/simulator/build_sim',
      names: { mcp: 'build_sim' },
    };
    const workflowInput = {
      id: 'simulator',
      title: 'iOS Simulator Development',
      description: 'Build and test iOS apps on simulators',
      tools: ['build_sim'],
    };

    const toolResult = toolManifestEntrySchema.safeParse(toolInput);
    const workflowResult = workflowManifestEntrySchema.safeParse(workflowInput);

    expect(toolResult.success).toBe(true);
    expect(workflowResult.success).toBe(true);

    if (!toolResult.success || !workflowResult.success) {
      throw new Error('Expected representative manifest inputs to parse');
    }

    expect(toolResult.data.availability).toEqual({ mcp: true, cli: true });
    expect(toolResult.data.nextSteps).toEqual([]);
    expect(toolResult.data.predicates).toEqual([]);
    expect(workflowResult.data.availability).toEqual({ mcp: true, cli: true });
    expect(workflowResult.data.predicates).toEqual([]);
    expect(workflowResult.data.tools).toEqual(['build_sim']);
    expect(getEffectiveCliName(toolResult.data)).toBe('build-sim');
  });

  describe('deriveCliName', () => {
    it('converts common identifier styles to kebab-case', () => {
      expect(deriveCliName('build_sim')).toBe('build-sim');
      expect(deriveCliName('getAppBundleId')).toBe('get-app-bundle-id');
      expect(deriveCliName('build-sim')).toBe('build-sim');
    });
  });

  describe('getEffectiveCliName', () => {
    it('prefers an explicit CLI name over the derived one', () => {
      const tool: ToolManifestEntry = {
        id: 'build_sim',
        module: 'mcp/tools/simulator/build_sim',
        names: { mcp: 'build_sim', cli: 'build-simulator' },
        availability: { mcp: true, cli: true },
        predicates: [],
        nextSteps: [],
      };

      expect(getEffectiveCliName(tool)).toBe('build-simulator');
    });
  });
});
