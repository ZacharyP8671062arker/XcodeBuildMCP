import * as fs from 'node:fs';
import * as path from 'node:path';
import { LOG_DIR } from './log-paths.ts';

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function generateLogFileName(toolName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${toolName}_${timestamp}_pid${process.pid}.log`;
}

export interface LogCapture {
  write(chunk: string): void;
  readonly path: string;
  close(): void;
}

export function createLogCapture(toolName: string): LogCapture {
  ensureLogDir();
  const logPath = path.join(LOG_DIR, generateLogFileName(toolName));
  const fd = fs.openSync(logPath, 'w');

  return {
    write(chunk: string): void {
      fs.writeSync(fd, chunk);
    },
    get path(): string {
      return logPath;
    },
    close(): void {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    },
  };
}

export interface ParserDebugCapture {
  addUnrecognizedLine(line: string): void;
  readonly count: number;
  flush(): string | null;
}

export function createParserDebugCapture(toolName: string): ParserDebugCapture {
  const lines: string[] = [];

  return {
    addUnrecognizedLine(line: string): void {
      lines.push(line);
    },
    get count(): number {
      return lines.length;
    },
    flush(): string | null {
      if (lines.length === 0) return null;
      ensureLogDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugPath = path.join(LOG_DIR, `${toolName}_parser-debug_${timestamp}.log`);
      fs.writeFileSync(
        debugPath,
        `Unrecognized xcodebuild output lines (${lines.length}):\n\n${lines.join('\n')}\n`,
      );
      return debugPath;
    },
  };
}
