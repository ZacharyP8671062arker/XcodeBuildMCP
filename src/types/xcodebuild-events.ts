export type XcodebuildOperation = 'BUILD' | 'TEST';

export type XcodebuildStage =
  | 'RESOLVING_PACKAGES'
  | 'COMPILING'
  | 'LINKING'
  | 'PREPARING_TESTS'
  | 'RUN_TESTS'
  | 'ARCHIVING'
  | 'COMPLETED';

export const STAGE_RANK: Record<XcodebuildStage, number> = {
  RESOLVING_PACKAGES: 0,
  COMPILING: 1,
  LINKING: 2,
  PREPARING_TESTS: 3,
  RUN_TESTS: 4,
  ARCHIVING: 5,
  COMPLETED: 6,
};

interface BaseEvent {
  timestamp: string;
}

export interface StartEvent extends BaseEvent {
  type: 'start';
  operation: XcodebuildOperation;
  toolName: string;
  params: Record<string, unknown>;
  message: string;
}

export interface StatusEvent extends BaseEvent {
  type: 'status';
  operation: XcodebuildOperation;
  stage: XcodebuildStage;
  message: string;
}

export type NoticeLevel = 'info' | 'success' | 'warning';

export type BuildRunStepName =
  | 'resolve-app-path'
  | 'resolve-simulator'
  | 'boot-simulator'
  | 'install-app'
  | 'extract-bundle-id'
  | 'launch-app';

export type BuildRunStepStatus = 'started' | 'succeeded';

export interface BuildRunStepNoticeData {
  step: BuildRunStepName;
  status: BuildRunStepStatus;
  appPath?: string;
}

export interface BuildRunResultNoticeData {
  scheme: string;
  platform: string;
  target: string;
  appPath: string;
  launchState: 'requested' | 'running';
  bundleId?: string;
  appId?: string;
  processId?: number;
}

export type NoticeCode = 'build-run-step' | 'build-run-result';

export interface NoticeEvent extends BaseEvent {
  type: 'notice';
  operation: XcodebuildOperation;
  level: NoticeLevel;
  message: string;
  code?: NoticeCode;
  data?:
    | Record<string, string | number | boolean>
    | BuildRunStepNoticeData
    | BuildRunResultNoticeData;
}

export interface WarningEvent extends BaseEvent {
  type: 'warning';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface TestDiscoveryEvent extends BaseEvent {
  type: 'test-discovery';
  operation: 'TEST';
  total: number;
  tests: string[];
  truncated: boolean;
}

export interface TestProgressEvent extends BaseEvent {
  type: 'test-progress';
  operation: 'TEST';
  completed: number;
  failed: number;
  skipped: number;
}

export interface TestFailureEvent extends BaseEvent {
  type: 'test-failure';
  operation: 'TEST';
  target?: string;
  suite?: string;
  test?: string;
  message: string;
  location?: string;
  durationMs?: number;
}

export interface SummaryEvent extends BaseEvent {
  type: 'summary';
  operation: XcodebuildOperation;
  status: 'SUCCEEDED' | 'FAILED';
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  durationMs?: number;
}

export interface NextStepsEvent extends BaseEvent {
  type: 'next-steps';
  steps: Array<{
    label?: string;
    tool?: string;
    workflow?: string;
    cliTool?: string;
    params?: Record<string, string | number | boolean>;
  }>;
}

export type XcodebuildEvent =
  | StartEvent
  | StatusEvent
  | NoticeEvent
  | WarningEvent
  | ErrorEvent
  | TestDiscoveryEvent
  | TestProgressEvent
  | TestFailureEvent
  | SummaryEvent
  | NextStepsEvent;
