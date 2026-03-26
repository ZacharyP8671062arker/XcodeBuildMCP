import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface DeviceInfo {
  identifier: string;
  name: string;
}

let cachedDevices: Map<string, string> | null = null;

function loadDeviceNames(): Map<string, string> {
  if (cachedDevices) return cachedDevices;

  const map = new Map<string, string>();
  const tmpFile = join(tmpdir(), `devicectl-list-${process.pid}.json`);

  try {
    execSync(`xcrun devicectl list devices --json-output ${tmpFile}`, {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: 'pipe',
    });

    const data = JSON.parse(readFileSync(tmpFile, 'utf8')) as {
      result?: { devices?: Array<{ identifier: string; deviceProperties: { name: string } }> };
    };

    for (const device of data.result?.devices ?? []) {
      map.set(device.identifier, device.deviceProperties.name);
    }
  } catch {
    // Device list unavailable — return empty map, will fall back to UUID only
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }

  cachedDevices = map;
  return map;
}

export function formatDeviceId(deviceId: string): string {
  const names = loadDeviceNames();
  const name = names.get(deviceId);
  if (name) {
    return `${name} (${deviceId})`;
  }
  return deviceId;
}
