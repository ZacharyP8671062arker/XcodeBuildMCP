import type { WorkflowGroup } from '../core/plugin-types.ts';
import { getConfig } from './config-store.ts';

export const REQUIRED_WORKFLOW = 'session-management';
export const WORKFLOW_DISCOVERY_WORKFLOW = 'workflow-discovery';
export const DEBUG_WORKFLOW = 'doctor';
export const DEFAULT_WORKFLOW = 'simulator';

type WorkflowName = string;

function normalizeWorkflowNames(workflowNames: WorkflowName[]): WorkflowName[] {
  return workflowNames.map((name) => name.trim().toLowerCase()).filter(Boolean);
}

function isWorkflowGroup(value: WorkflowGroup | undefined): value is WorkflowGroup {
  return Boolean(value);
}

export function isDebugEnabled(): boolean {
  return getConfig().debug;
}

export function isWorkflowDiscoveryEnabled(): boolean {
  return getConfig().experimentalWorkflowDiscovery;
}

function resolveSelectedWorkflowNames(
  workflowNames: WorkflowName[] = [],
  availableWorkflowNames: WorkflowName[] = [],
): {
  selectedWorkflowNames: WorkflowName[];
  selectedNames: WorkflowName[];
} {
  const normalizedNames = normalizeWorkflowNames(workflowNames);
  const baseAutoSelected = [REQUIRED_WORKFLOW];

  if (isWorkflowDiscoveryEnabled()) {
    baseAutoSelected.push(WORKFLOW_DISCOVERY_WORKFLOW);
  }

  if (isDebugEnabled()) {
    baseAutoSelected.push(DEBUG_WORKFLOW);
  }

  const effectiveNames = normalizedNames.length > 0 ? normalizedNames : [DEFAULT_WORKFLOW];
  const selectedNames = [...new Set([...baseAutoSelected, ...effectiveNames])];

  const selectedWorkflowNames = selectedNames.filter((workflowName) =>
    availableWorkflowNames.includes(workflowName),
  );

  return { selectedWorkflowNames, selectedNames };
}

export function resolveSelectedWorkflows(
  workflowNames: WorkflowName[] = [],
  workflowGroupsParam?: Map<WorkflowName, WorkflowGroup>,
): {
  selectedWorkflows: WorkflowGroup[];
  selectedNames: WorkflowName[];
} {
  const resolvedWorkflowGroups = workflowGroupsParam ?? new Map<WorkflowName, WorkflowGroup>();
  const availableWorkflowNames = [...resolvedWorkflowGroups.keys()];
  const selection = resolveSelectedWorkflowNames(workflowNames, availableWorkflowNames);

  const selectedWorkflows = selection.selectedWorkflowNames
    .map((workflowName) => resolvedWorkflowGroups.get(workflowName))
    .filter(isWorkflowGroup);

  return { selectedWorkflows, selectedNames: selection.selectedNames };
}
