import { describe, expect, it } from 'vitest';
import type { StructuredOutputEnvelope } from '../../types/structured-output.ts';
import { normalizeStructuredEnvelope } from '../json-normalize.ts';

describe('normalizeStructuredEnvelope', () => {
  it('keeps only failing test cases for failed result snapshots', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: true,
      error: 'Tests failed',
      data: {
        summary: { target: 'simulator' },
        testCases: [
          { test: 'Volatile Swift Testing pass', status: 'passed', durationMs: 12 },
          { test: 'Swift Testing failure', status: 'failed', durationMs: 34 },
          { suite: 'XCTestSuite', test: 'testStablePass', status: 'passed', durationMs: 56 },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: true,
      error: 'Tests failed',
      data: {
        summary: { target: 'simulator' },
        testCases: [{ test: 'Swift Testing failure', status: 'failed', durationMs: 0 }],
      },
    });
  });

  it('preserves xcresult paths in test result artifacts', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'simulator' },
        artifacts: {
          buildLogPath: '/tmp/build.log',
          xcresultPath: '/tmp/App Tests.xcresult',
        },
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual(envelope);
  });

  it('keeps suite-less passed test cases for non-simulator results', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'swift-package' },
        testCases: [{ test: 'Package Swift Testing pass', status: 'passed', durationMs: 12 }],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'swift-package' },
        testCases: [{ test: 'Package Swift Testing pass', status: 'passed', durationMs: 0 }],
      },
    });
  });

  it('normalizes and sorts SwiftPM build progress lines in stderr arrays', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-run-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        output: {
          stderr: [
            'Building for debugging...',
            '[5/8] Emitting module spm',
            '[4/8] Compiling spm main.swift',
            "Build of product 'spm' complete! (0.42s)",
          ],
        },
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-run-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        output: {
          stderr: [
            'Building for debugging...',
            '[<STEP>] Compiling spm main.swift',
            '[<STEP>] Emitting module spm',
            "Build of product 'spm' complete! (<DURATION>)",
          ],
        },
      },
    });
  });

  it('normalizes volatile build settings entry values without dropping entries', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'ALTERNATE_OWNER', value: 'cameroncooke' },
          { key: 'CACHE_ROOT', value: '/var/folders/hash/C/com.apple.DeveloperTools/26.4/Xcode' },
          { key: 'TARGET_DEVICE_MODEL', value: 'iPhone17,2' },
          { key: 'TARGET_DEVICE_OS_VERSION', value: '26.4.2' },
          {
            key: 'PLATFORM_DEVELOPER_APPLICATIONS_DIR',
            value: '/Applications/Xcode-26.4.0.app/Contents/Developer/Applications',
          },
          {
            key: 'SDK_STAT_CACHE_PATH',
            value:
              '<HOME>/Library/Developer/Xcode/DerivedData/SDKStatCaches.noindex/iphoneos26.4-23E237-c1e9.sdkstatcache',
          },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'ALTERNATE_OWNER', value: '<USER>' },
          { key: 'CACHE_ROOT', value: '<XCODE_CACHE_ROOT>' },
          { key: 'TARGET_DEVICE_MODEL', value: '<DEVICE_MODEL>' },
          { key: 'TARGET_DEVICE_OS_VERSION', value: '<OS_VERSION>' },
          {
            key: 'PLATFORM_DEVELOPER_APPLICATIONS_DIR',
            value: '/Applications/Xcode-<VERSION>.app/Contents/Developer/Applications',
          },
          { key: 'SDK_STAT_CACHE_PATH', value: '<SDK_STAT_CACHE_PATH>' },
        ],
      },
    });
  });

  it('normalizes volatile build settings PATH entry values without dropping the entry', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'SDKROOT', value: 'iphoneos' },
          { key: 'PATH', value: '/volatile/bin:/another/volatile/bin' },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'SDKROOT', value: 'iphoneos' },
          { key: 'PATH', value: '<PATH_ENTRIES>' },
        ],
      },
    });
  });
});
