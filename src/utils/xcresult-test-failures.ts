import { execFileSync } from 'node:child_process';
import { log } from './logger.ts';
import type { PipelineEvent } from '../types/pipeline-events.ts';

interface XcresultTestNode {
  name: string;
  nodeType: string;
  result?: string;
  children?: XcresultTestNode[];
}

interface XcresultTestResults {
  testNodes: XcresultTestNode[];
}

/**
 * Extract test failure events from an xcresult bundle using xcresulttool.
 * Returns test-failure PipelineEvents for any failed test cases found.
 */
export function extractTestFailuresFromXcresult(xcresultPath: string): PipelineEvent[] {
  try {
    const output = execFileSync(
      'xcrun',
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const results: XcresultTestResults = JSON.parse(output);
    const events: PipelineEvent[] = [];

    function walk(node: XcresultTestNode): void {
      if (node.nodeType === 'Test Case' && node.result === 'Failed' && node.children) {
        for (const child of node.children) {
          if (child.nodeType === 'Failure Message') {
            const parsed = parseFailureMessage(child.name);
            events.push({
              type: 'test-failure',
              timestamp: new Date().toISOString(),
              operation: 'TEST',
              test: node.name,
              message: parsed.message,
              location: parsed.location,
            });
          }
        }
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }

    for (const root of results.testNodes) {
      walk(root);
    }

    return events;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('debug', `Failed to extract test failures from xcresult: ${message}`);
    return [];
  }
}

/**
 * Parse a failure message string from xcresulttool.
 * Format: "File.swift:11: Expectation failed: 1 == 2: User message"
 * or just: "Some failure message"
 */
function parseFailureMessage(raw: string): { message: string; location?: string } {
  const match = raw.match(/^(.+?):(\d+): (.+)$/);
  if (match) {
    return {
      location: `${match[1]}:${match[2]}`,
      message: match[3],
    };
  }
  return { message: raw };
}
