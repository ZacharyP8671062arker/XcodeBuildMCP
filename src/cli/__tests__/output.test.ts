import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextContent } from '../../types/common.ts';
import { printToolResponse } from '../output.ts';

describe('printToolResponse', () => {
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

    printToolResponse({
      content: [
        createTextContent(
          [
            'Failed Tests',
            'CalculatorAppTests',
            ' ✗ testCalculatorServiceFailure (0.009s)',
            ' └─ XCTAssertEqual failed: ("0") is not equal to ("999")',
            '  /tmp/CalculatorAppTests.swift:52: error: XCTAssertEqual failed: ("0") is not equal to ("999")',
            'Test Summary',
            'error: compiler command failed with exit code 1',
            '❌ Test Run test failed for scheme CalculatorApp.',
          ].join('\n'),
        ),
      ],
      isError: true,
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Failed Tests\n');
    expect(output).toContain(' \u001B[31m✗ \u001B[0mtestCalculatorServiceFailure (0.009s)\n');
    expect(output).toContain(' └─ XCTAssertEqual failed: ("0") is not equal to ("999")\n');
    expect(output).toContain(
      '\u001B[31m  /tmp/CalculatorAppTests.swift:52: error: XCTAssertEqual failed: ("0") is not equal to ("999")\u001B[0m',
    );
    expect(output).toContain(
      '\u001B[31merror: compiler command failed with exit code 1\u001B[0m\n',
    );
    expect(output).toContain(
      '\u001B[31m❌ \u001B[0mTest Run test failed for scheme CalculatorApp.\n',
    );
    expect(output).toContain('CalculatorAppTests\n');
    expect(output).toContain('Test Summary\n');
    expect(process.exitCode).toBe(1);
  });

  it('does not replay already-streamed pipeline text in TTY mode', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    printToolResponse({
      content: [createTextContent('build started'), createTextContent('app launched successfully')],
      _meta: {
        events: [{ type: 'start', timestamp: '2026-03-18T12:00:00.000Z' }],
        streamedContentCount: 1,
      },
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).not.toContain('build started');
    expect(output).toContain('app launched successfully\n');
  });

  it('prints next steps when all prior text was already streamed in TTY mode', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    printToolResponse({
      content: [createTextContent('build succeeded')],
      nextSteps: [
        {
          tool: 'launch_app_sim',
          workflow: 'simulator',
          cliTool: 'launch-app-sim',
          params: { simulatorId: 'SIM-1', bundleId: 'com.example.app' },
        },
      ],
      _meta: {
        events: [
          {
            type: 'summary',
            timestamp: '2026-03-18T12:00:00.000Z',
            operation: 'BUILD',
            status: 'SUCCEEDED',
          },
        ],
        streamedContentCount: 1,
      },
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Next steps:\n');
    expect(output).toContain(
      'xcodebuildmcp simulator launch-app-sim --simulator-id "SIM-1" --bundle-id "com.example.app"\n',
    );
  });

  it('emits appended events as JSONL after the streamed event prefix', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printToolResponse(
      {
        content: [createTextContent('build succeeded')],
        _meta: {
          events: [
            { type: 'start', timestamp: '2026-03-18T12:00:00.000Z' },
            {
              type: 'summary',
              timestamp: '2026-03-18T12:00:01.000Z',
              operation: 'BUILD',
              status: 'SUCCEEDED',
            },
            {
              type: 'next-steps',
              timestamp: '2026-03-18T12:00:02.000Z',
              steps: [{ tool: 'launch_app_sim' }],
            },
          ],
          streamedEventCount: 2,
          streamedContentCount: 1,
        },
      },
      { format: 'json' },
    );

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output.trim()).toBe(
      JSON.stringify({
        type: 'next-steps',
        timestamp: '2026-03-18T12:00:02.000Z',
        steps: [{ tool: 'launch_app_sim' }],
      }),
    );
  });
});
