import { describe, it, expect } from 'vitest';
import { VERSION_REGEX, validateVersion } from '../version/version-validation.ts';

describe('generate-version: VERSION_REGEX validation', () => {
  it('accepts standard semver', () => {
    expect(VERSION_REGEX.test('2.3.0')).toBe(true);
  });

  it('accepts v-prefixed semver', () => {
    expect(VERSION_REGEX.test('v1.0.8')).toBe(true);
  });

  it('accepts pre-release semver', () => {
    expect(VERSION_REGEX.test('1.0.0-beta.1')).toBe(true);
  });

  it('accepts pre-release with hyphens', () => {
    expect(VERSION_REGEX.test('1.0.0-rc-1')).toBe(true);
  });

  it('accepts build metadata', () => {
    expect(VERSION_REGEX.test('1.0.0+build.123')).toBe(true);
  });

  it('accepts pre-release + build metadata', () => {
    expect(VERSION_REGEX.test('1.0.0-alpha.1+meta')).toBe(true);
  });

  it('rejects injection payloads with single quotes', () => {
    expect(VERSION_REGEX.test("'; process.exit(1); //")).toBe(false);
  });

  it('rejects injection payloads with template literals', () => {
    expect(VERSION_REGEX.test('${process.exit(1)}')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(VERSION_REGEX.test('')).toBe(false);
  });

  it('rejects arbitrary text', () => {
    expect(VERSION_REGEX.test('not-a-version')).toBe(false);
  });
});

describe('generate-version: validateVersion', () => {
  it('throws for invalid versions', () => {
    expect(() => validateVersion('version', "1.0.0'; process.exit(1); //")).toThrow(
      /Invalid version in package\.json/,
    );
  });

  it('does not throw for valid versions', () => {
    expect(() => validateVersion('version', '1.0.0-alpha.1+meta')).not.toThrow();
  });
});
