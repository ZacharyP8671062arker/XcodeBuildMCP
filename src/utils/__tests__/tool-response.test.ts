import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { statusLine, nextSteps } from '../tool-event-builders.ts';
import { toolResponse } from '../tool-response.ts';

describe('toolResponse metadata', () => {
  const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;
  const originalFormat = process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
  const originalVerbose = process.env.XCODEBUILDMCP_VERBOSE;

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.XCODEBUILDMCP_RUNTIME;
    else process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
    if (originalFormat === undefined) delete process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT;
    else process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = originalFormat;
    if (originalVerbose === undefined) delete process.env.XCODEBUILDMCP_VERBOSE;
    else process.env.XCODEBUILDMCP_VERBOSE = originalVerbose;
  });

  it('retains events in _meta.events when events are provided', () => {
    const events = [statusLine('success', 'Done')];
    const response = toolResponse(events);

    expect(response._meta?.events).toBeDefined();
    expect(response._meta?.events).toHaveLength(1);
    const stored = (response._meta?.events as Array<{ type: string }>)[0];
    expect(stored.type).toBe('status-line');
  });

  it('sets streamedEventCount and streamedContentCount when CLI renderer is active', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'text';
    delete process.env.XCODEBUILDMCP_VERBOSE;

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const events = [statusLine('success', 'Done')];
    const response = toolResponse(events);
    stdoutWrite.mockRestore();

    expect(response._meta?.events).toHaveLength(1);
    expect(response._meta?.streamedEventCount).toBe(1);
    expect(typeof response._meta?.streamedContentCount).toBe('number');
    expect(response._meta?.pipelineStreamMode).toBe('complete');
  });

  it('omits streamed counters when suppressCliStream is true', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    process.env.XCODEBUILDMCP_CLI_OUTPUT_FORMAT = 'text';
    delete process.env.XCODEBUILDMCP_VERBOSE;

    const events = [statusLine('success', 'Done')];
    const response = toolResponse(events, { suppressCliStream: true });

    expect(response._meta?.events).toHaveLength(1);
    expect(response._meta?.pipelineStreamMode).toBeUndefined();
  });

  it('omits events metadata when no events are provided', () => {
    const response = toolResponse([]);

    expect(response._meta?.events).toBeUndefined();
  });
});
