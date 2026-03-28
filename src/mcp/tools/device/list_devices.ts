/**
 * Device Workspace Plugin: List Devices
 *
 * Lists connected physical Apple devices (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
 * with their UUIDs, names, and connection status. Use this to discover physical devices for testing.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section, table } from '../../../utils/tool-event-builders.ts';

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
  if (platformId.includes('appletv') || platformId.includes('tvos') || platformId.includes('apple tv')) {
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

            const platform = getPlatformLabel(device.deviceProperties?.platformIdentifier);

            // Determine connection state
            const pairingState = device.connectionProperties?.pairingState ?? '';
            const tunnelState = device.connectionProperties?.tunnelState ?? '';
            const transportType = device.connectionProperties?.transportType ?? '';

            let state: string;
            if (pairingState !== 'paired') {
              state = 'Unpaired';
            } else if (tunnelState === 'connected') {
              state = 'Available';
            } else {
              state = 'Available (WiFi)';
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

    const availableDevices = uniqueDevices.filter((d) => isAvailableState(d.state));
    const pairedDevices = uniqueDevices.filter((d) => d.state === 'Paired (not connected)');
    const unpairedDevices = uniqueDevices.filter((d) => d.state === 'Unpaired');

    if (availableDevices.length > 0) {
      events.push(
        table(
          ['Name', 'Identifier', 'Platform', 'Model', 'Connection', 'Developer Mode'],
          availableDevices.map((device) => ({
            Name: device.name,
            Identifier: device.identifier,
            Platform: `${device.platform} ${device.osVersion ?? ''}`.trim(),
            Model: device.model ?? device.productType ?? 'Unknown',
            Connection: device.connectionType || 'Unknown',
            'Developer Mode': device.developerModeStatus ?? 'Unknown',
          })),
          'Available Devices',
        ),
      );
    }

    if (pairedDevices.length > 0) {
      events.push(
        table(
          ['Name', 'Identifier', 'Platform', 'Model'],
          pairedDevices.map((device) => ({
            Name: device.name,
            Identifier: device.identifier,
            Platform: `${device.platform} ${device.osVersion ?? ''}`.trim(),
            Model: device.model ?? device.productType ?? 'Unknown',
          })),
          'Paired Devices',
        ),
      );
    }

    if (unpairedDevices.length > 0) {
      events.push(
        table(
          ['Name', 'Identifier', 'Platform'],
          unpairedDevices.map((device) => ({
            Name: device.name,
            Identifier: device.identifier,
            Platform: `${device.platform} ${device.osVersion ?? ''}`.trim(),
          })),
          'Unpaired Devices',
        ),
      );
    }

    const availableDevicesExist = uniqueDevices.some((d) => isAvailableState(d.state));

    let nextStepParams: Record<string, Record<string, string | number | boolean>> | undefined;

    if (availableDevicesExist) {
      events.push(
        statusLine('success', 'Devices discovered.'),
        section('Hints', [
          'Use the device ID/UDID from above when required by other tools.',
          "Save a default device with session-set-defaults { deviceId: 'DEVICE_UDID' }.",
          'Before running build/run/test/UI automation tools, set the desired device identifier in session defaults.',
        ]),
      );

      nextStepParams = {
        build_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        build_run_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        test_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        get_device_app_path: { scheme: 'SCHEME' },
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

    return toolResponse(events, nextStepParams ? { nextStepParams } : undefined);
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
