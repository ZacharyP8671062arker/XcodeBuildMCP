import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const listDevicesSchema = z.object({});

type ListDevicesParams = z.infer<typeof listDevicesSchema>;

function isAvailableState(state: string): boolean {
  return state === 'Available' || state === 'Available (WiFi)' || state === 'Connected';
}

function getPlatformLabel(platformIdentifier?: string): string {
  const platformId = platformIdentifier?.toLowerCase() ?? '';

  if (platformId.includes('iphone') || platformId.includes('ios')) {
    return 'iOS';
  }
  if (platformId.includes('ipad')) {
    return 'iPadOS';
  }
  if (platformId.includes('watch')) {
    return 'watchOS';
  }
  if (
    platformId.includes('appletv') ||
    platformId.includes('tvos') ||
    platformId.includes('apple tv')
  ) {
    return 'tvOS';
  }
  if (platformId.includes('xros') || platformId.includes('vision')) {
    return 'visionOS';
  }
  if (platformId.includes('mac')) {
    return 'macOS';
  }

  return 'Unknown';
}

function getPlatformOrder(platform: string): number {
  switch (platform) {
    case 'iOS':
      return 0;
    case 'iPadOS':
      return 1;
    case 'watchOS':
      return 2;
    case 'tvOS':
      return 3;
    case 'visionOS':
      return 4;
    case 'macOS':
      return 5;
    default:
      return 6;
  }
}

function getDeviceEmoji(platform: string): string {
  switch (platform) {
    case 'watchOS':
      return '⌚️';
    case 'tvOS':
      return '📺';
    case 'visionOS':
      return '🥽';
    case 'macOS':
      return '💻';
    default:
      return '📱';
  }
}

function renderGroupedDevices(
  devices: Array<{
    name: string;
    identifier: string;
    platform: string;
    osVersion?: string;
    state: string;
  }>,
): string {
  const grouped = new Map<string, typeof devices>();

  for (const device of devices) {
    const group = grouped.get(device.platform) ?? [];
    group.push(device);
    grouped.set(device.platform, group);
  }

  const lines: string[] = ['📱 List Devices', ''];
  const orderedPlatforms = [...grouped.keys()].sort(
    (a, b) => getPlatformOrder(a) - getPlatformOrder(b),
  );

  for (const platform of orderedPlatforms) {
    const platformDevices = grouped.get(platform) ?? [];
    if (platformDevices.length === 0) {
      continue;
    }

    lines.push(`${platform} Devices:`);
    lines.push('');

    for (const device of platformDevices) {
      const availability = isAvailableState(device.state) ? '✓' : '✗';
      lines.push(`  ${getDeviceEmoji(platform)} [${availability}] ${device.name}`);
      lines.push(`    OS: ${device.osVersion ?? 'Unknown'}`);
      lines.push(`    UDID: ${device.identifier}`);
      lines.push('');
    }
  }

  const platformCounts = orderedPlatforms.map((platform) => {
    const count = grouped.get(platform)?.length ?? 0;
    return `${count} ${platform}`;
  });

  lines.push(`✅ ${devices.length} physical devices discovered (${platformCounts.join(', ')}).`);

  return lines.join('\n');
}

/**
 * Business logic for listing connected devices
 */
export async function list_devicesLogic(
  _params: ListDevicesParams,
  executor: CommandExecutor,
  pathDeps?: { tmpdir?: () => string; join?: (...paths: string[]) => string },
  fsDeps?: {
    readFile?: (path: string, encoding?: string) => Promise<string>;
    unlink?: (path: string) => Promise<void>;
  },
): Promise<ToolResponse> {
  log('info', 'Starting device discovery');
  const headerEvent = header('List Devices');

  try {
    // Try modern devicectl with JSON output first (iOS 17+, Xcode 15+)
    const tempDir = pathDeps?.tmpdir ? pathDeps.tmpdir() : tmpdir();
    const timestamp = pathDeps?.join ? '123' : Date.now(); // Use fixed timestamp for tests
    const tempJsonPath = pathDeps?.join
      ? pathDeps.join(tempDir, `devicectl-${timestamp}.json`)
      : join(tempDir, `devicectl-${timestamp}.json`);
    const devices = [];
    let useDevicectl = false;

    try {
      const result = await executor(
        ['xcrun', 'devicectl', 'list', 'devices', '--json-output', tempJsonPath],
        'List Devices (devicectl with JSON)',
        false,
      );

      if (result.success) {
        useDevicectl = true;
        // Read and parse the JSON file
        const jsonContent = fsDeps?.readFile
          ? await fsDeps.readFile(tempJsonPath, 'utf8')
          : await fs.readFile(tempJsonPath, 'utf8');
        const deviceCtlData: unknown = JSON.parse(jsonContent);

        const deviceCtlResult = deviceCtlData as { result?: { devices?: unknown[] } };
        const deviceList = deviceCtlResult?.result?.devices;

        if (Array.isArray(deviceList)) {
          for (const deviceRaw of deviceList) {
            if (typeof deviceRaw !== 'object' || deviceRaw === null) continue;

            const device = deviceRaw as {
              visibilityClass?: string;
              connectionProperties?: {
                pairingState?: string;
                tunnelState?: string;
                transportType?: string;
              };
              deviceProperties?: {
                platformIdentifier?: string;
                name?: string;
                osVersionNumber?: string;
                developerModeStatus?: string;
                marketingName?: string;
              };
              hardwareProperties?: {
                productType?: string;
                cpuType?: { name?: string };
              };
              identifier?: string;
            };

            // Skip simulators or unavailable devices
            if (
              device.visibilityClass === 'Simulator' ||
              !device.connectionProperties?.pairingState
            ) {
              continue;
            }

            const platform = getPlatformLabel(
              [
                device.deviceProperties?.platformIdentifier,
                device.deviceProperties?.marketingName,
                device.hardwareProperties?.productType,
                device.deviceProperties?.name,
              ]
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
                .join(' '),
            );

            // Determine connection state
            const pairingState = device.connectionProperties?.pairingState ?? '';
            const tunnelState = device.connectionProperties?.tunnelState ?? '';
            const transportType = device.connectionProperties?.transportType ?? '';
            const hasDirectConnection =
              tunnelState === 'connected' ||
              transportType === 'wired' ||
              transportType === 'localNetwork';

            let state: string;
            if (pairingState !== 'paired') {
              state = 'Unpaired';
            } else if (hasDirectConnection) {
              state = 'Available';
            } else {
              state = 'Paired (not connected)';
            }

            devices.push({
              name: device.deviceProperties?.name ?? 'Unknown Device',
              identifier: device.identifier ?? 'Unknown',
              platform,
              model:
                device.deviceProperties?.marketingName ?? device.hardwareProperties?.productType,
              osVersion: device.deviceProperties?.osVersionNumber,
              state,
              connectionType: transportType,
              trustState: pairingState,
              developerModeStatus: device.deviceProperties?.developerModeStatus,
              productType: device.hardwareProperties?.productType,
              cpuArchitecture: device.hardwareProperties?.cpuType?.name,
            });
          }
        }
      }
    } catch {
      log('info', 'devicectl with JSON failed, trying xctrace fallback');
    } finally {
      // Clean up temp file
      try {
        if (fsDeps?.unlink) {
          await fsDeps.unlink(tempJsonPath);
        } else {
          await fs.unlink(tempJsonPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // If devicectl failed or returned no devices, fallback to xctrace
    if (!useDevicectl || devices.length === 0) {
      const result = await executor(
        ['xcrun', 'xctrace', 'list', 'devices'],
        'List Devices (xctrace)',
        false,
      );

      if (!result.success) {
        return toolResponse([
          headerEvent,
          statusLine('error', `Failed to list devices: ${result.error}`),
          section('Troubleshooting', [
            'Make sure Xcode is installed and devices are connected and trusted.',
          ]),
        ]);
      }

      return toolResponse([
        headerEvent,
        section('Device listing (xctrace output)', [result.output]),
        statusLine(
          'info',
          'For better device information, please upgrade to Xcode 15 or later which supports the modern devicectl command.',
        ),
      ]);
    }

    const uniqueDevices = devices.filter(
      (device, index, self) => index === self.findIndex((d) => d.identifier === device.identifier),
    );

    const events: PipelineEvent[] = [headerEvent];

    if (uniqueDevices.length === 0) {
      events.push(
        statusLine('warning', 'No physical Apple devices found.'),
        section('Troubleshooting', [
          'Make sure:',
          '1. Devices are connected via USB or WiFi',
          '2. Devices are unlocked and trusted',
          '3. "Trust this computer" has been accepted on the device',
          '4. Developer mode is enabled on the device (iOS 16+)',
          '5. Xcode is properly installed',
          '',
          'For simulators, use the list_sims tool instead.',
        ]),
      );
      return toolResponse(events);
    }

    const availableDevicesExist = uniqueDevices.some((d) => isAvailableState(d.state));

    const renderedDeviceList = renderGroupedDevices(
      uniqueDevices.map((device) => ({
        name: device.name,
        identifier: device.identifier,
        platform: device.platform,
        osVersion: device.osVersion,
        state: device.state,
      })),
    );

    if (availableDevicesExist) {
      return {
        content: [
          {
            type: 'text',
            text: `\n${renderedDeviceList}\n\nHints\n  Use the device ID/UDID from above when required by other tools.\n  Save a default device with session-set-defaults { deviceId: 'DEVICE_UDID' }.\n  Before running build/run/test/UI automation tools, set the desired device identifier in session defaults.`,
          },
        ],
        nextSteps: [],
      };
    } else if (uniqueDevices.length > 0) {
      events.push(
        statusLine('warning', 'No devices are currently available for testing.'),
        section('Troubleshooting', [
          'Make sure devices are:',
          '- Connected via USB',
          '- Unlocked and trusted',
          '- Have developer mode enabled (iOS 16+)',
        ]),
      );
    }

    return toolResponse(events);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error listing devices: ${errorMessage}`);
    return toolResponse([
      headerEvent,
      statusLine('error', `Failed to list devices: ${errorMessage}`),
    ]);
  }
}

export const schema = listDevicesSchema.shape;

export const handler = createTypedTool(
  listDevicesSchema,
  list_devicesLogic,
  getDefaultCommandExecutor,
);
