import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const CACHE_TTL_MS = 30_000;
const execFileAsync = promisify(execFile);

let cachedDevices: Map<string, string> | null = null;
let cacheTimestamp = 0;
let loadPromise: Promise<void> | null = null;

interface DeviceCtlEntry {
  identifier: string;
  deviceProperties: { name: string };
  hardwareProperties?: { udid?: string };
}

function cacheIsFresh(): boolean {
  return cachedDevices !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

function createDeviceMap(data: { result?: { devices?: DeviceCtlEntry[] } }): Map<string, string> {
  const map = new Map<string, string>();

  for (const device of data.result?.devices ?? []) {
    const name = device.deviceProperties.name;
    map.set(device.identifier, name);
    if (device.hardwareProperties?.udid) {
      map.set(device.hardwareProperties.udid, name);
    }
  }

  return map;
}

async function refreshDeviceNames(): Promise<void> {
  if (cacheIsFresh()) {
    return;
  }

  if (loadPromise) {
    return loadPromise;
  }

  const tmpFile = join(tmpdir(), `devicectl-list-${process.pid}-${Date.now()}.json`);

  loadPromise = (async () => {
    try {
      await execFileAsync('xcrun', ['devicectl', 'list', 'devices', '--json-output', tmpFile], {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const data = JSON.parse(await readFile(tmpFile, 'utf8')) as {
        result?: { devices?: DeviceCtlEntry[] };
      };

      cachedDevices = createDeviceMap(data);
      cacheTimestamp = Date.now();
    } catch {
      // Device list unavailable -- keep existing cache and fall back to UUID only
      if (cachedDevices === null) {
        cachedDevices = new Map();
        cacheTimestamp = Date.now();
      }
    } finally {
      loadPromise = null;
      try {
        await unlink(tmpFile);
      } catch {
        // ignore
      }
    }
  })();

  return loadPromise;
}

function ensureDeviceNamesRefresh(): void {
  void refreshDeviceNames();
}

export function resolveDeviceName(deviceId: string): string | undefined {
  if (!cacheIsFresh()) {
    ensureDeviceNamesRefresh();
  }

  return cachedDevices?.get(deviceId);
}

export function formatDeviceId(deviceId: string): string {
  const name = resolveDeviceName(deviceId);
  if (name) {
    return `${name} (${deviceId})`;
  }
  return deviceId;
}
