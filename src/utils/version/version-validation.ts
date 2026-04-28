export const VERSION_REGEX = /^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.\-]+)?(\+[a-zA-Z0-9.\-]+)?$/;

export function validateVersion(name: string, value: string): void {
  if (!VERSION_REGEX.test(value)) {
    throw new Error(
      `Invalid ${name} in package.json: ${JSON.stringify(value)}. Expected a version string.`,
    );
  }
}
