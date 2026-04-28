import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, readFileMock, unlinkMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  unlink: unlinkMock,
}));

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('device-name-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads device names asynchronously and caches resolved names', async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', '');
        return {};
      },
    );

    readFileMock.mockResolvedValue(
      JSON.stringify({
        result: {
          devices: [
            {
              identifier: 'device-1',
              deviceProperties: { name: 'iPhone 15 Pro' },
              hardwareProperties: { udid: 'udid-1' },
            },
          ],
        },
      }),
    );
    unlinkMock.mockResolvedValue(undefined);

    const { resolveDeviceName, formatDeviceId } = await import('../device-name-resolver.ts');

    expect(resolveDeviceName('device-1')).toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    await flushAsyncWork();

    expect(resolveDeviceName('device-1')).toBe('iPhone 15 Pro');
    expect(resolveDeviceName('udid-1')).toBe('iPhone 15 Pro');
    expect(formatDeviceId('device-1')).toBe('iPhone 15 Pro (device-1)');
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('does not spawn duplicate refreshes while one is in flight', async () => {
    let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        cb: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback = cb;
        return {};
      },
    );

    readFileMock.mockResolvedValue(
      JSON.stringify({
        result: { devices: [{ identifier: 'device-2', deviceProperties: { name: 'iPad' } }] },
      }),
    );
    unlinkMock.mockResolvedValue(undefined);

    const { resolveDeviceName } = await import('../device-name-resolver.ts');

    expect(resolveDeviceName('device-2')).toBeUndefined();
    expect(resolveDeviceName('device-2')).toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callback?.(null, '', '');
    await flushAsyncWork();

    expect(resolveDeviceName('device-2')).toBe('iPad');
  });
});
