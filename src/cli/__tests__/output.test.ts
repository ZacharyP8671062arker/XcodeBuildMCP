import { afterEach, describe, expect, it, vi } from 'vitest';
import { printSessionOutput, type SessionOutputData } from '../output.ts';
import type { PipelineEvent } from '../../types/pipeline-events.ts';

function makeSessionData(opts: {
  text: string;
  events?: PipelineEvent[];
  isError?: boolean;
}): SessionOutputData {
  return {
    text: opts.text,
    events: opts.events ?? [],
    attachments: [],
    isError: opts.isError ?? false,
  };
}

describe('printSessionOutput', () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it('colors inline errors red and summary failures with a red marker in text output when stdout is a TTY', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    delete process.env.NO_COLOR;

    const text = [
      'Failed Tests',
      'CalculatorAppTests',
      ' \u2717 testCalculatorServiceFailure (0.009s)',
      ' \u2514\u2500 XCTAssertEqual failed: ("0") is not equal to ("999")',
      '  /tmp/CalculatorAppTests.swift:52: error: XCTAssertEqual failed: ("0") is not equal to ("999")',
      'Test Summary',
      'error: compiler command failed with exit code 1',
      '\u274C Test Run test failed for scheme CalculatorApp.',
    ].join('\n');

    printSessionOutput(makeSessionData({ text, isError: true }));

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Failed Tests\n');
    expect(output).toContain(' \u001B[31m\u2717 \u001B[0mtestCalculatorServiceFailure (0.009s)\n');
    expect(output).toContain(
      ' \u2514\u2500 XCTAssertEqual failed: ("0") is not equal to ("999")\n',
    );
    expect(output).toContain(
      '\u001B[31m  /tmp/CalculatorAppTests.swift:52: error: XCTAssertEqual failed: ("0") is not equal to ("999")\u001B[0m',
    );
    expect(output).toContain(
      '\u001B[31merror: compiler command failed with exit code 1\u001B[0m\n',
    );
    expect(output).toContain(
      '\u001B[31m\u274C \u001B[0mTest Run test failed for scheme CalculatorApp.\n',
    );
    expect(output).toContain('CalculatorAppTests\n');
    expect(output).toContain('Test Summary\n');
    expect(process.exitCode).toBe(1);
  });

  it('prints session events via CLI renderer when all events are renderable', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const events: PipelineEvent[] = [
      {
        type: 'status-line',
        timestamp: '2026-03-18T12:00:00.000Z',
        level: 'success',
        message: 'Build succeeded',
      },
    ];

    printSessionOutput(makeSessionData({ text: 'Build succeeded', events }));

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Build succeeded');
  });

  it('prints events as JSONL in json format', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const events: PipelineEvent[] = [
      {
        type: 'status-line',
        timestamp: '2026-03-18T12:00:00.000Z',
        level: 'success',
        message: 'Build succeeded',
      },
      {
        type: 'next-steps',
        timestamp: '2026-03-18T12:00:02.000Z',
        steps: [{ tool: 'launch_app_sim' }],
      },
    ];

    printSessionOutput(makeSessionData({ text: 'Build succeeded', events }), { format: 'json' });

    const output = stdoutWrite.mock.calls.flat().join('');
    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(events[0]);
    expect(JSON.parse(lines[1])).toEqual(events[1]);
  });
});
