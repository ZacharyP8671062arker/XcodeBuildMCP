import * as z from 'zod';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor, type CommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  applyWorkflowSelectionFromManifest,
  getRegisteredWorkflows,
  getMcpPredicateContext,
} from '../../../utils/tool-registry.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const baseSchemaObject = z.object({
  workflowNames: z.array(z.string()).describe('Workflow directory name(s).'),
  enable: z.boolean().describe('Enable or disable the selected workflows.'),
});

const manageWorkflowsSchema = z.preprocess(nullifyEmptyStrings, baseSchemaObject);

export type ManageWorkflowsParams = z.infer<typeof manageWorkflowsSchema>;

export async function manage_workflowsLogic(
  params: ManageWorkflowsParams,
  _neverExecutor: CommandExecutor,
): Promise<ToolResponse> {
  const workflowNames = params.workflowNames;
  const currentWorkflows = getRegisteredWorkflows();
  const requestedSet = new Set(
    workflowNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  let nextWorkflows: string[];
  if (params.enable === false) {
    nextWorkflows = currentWorkflows.filter((name) => !requestedSet.has(name.toLowerCase()));
  } else {
    nextWorkflows = [...new Set([...currentWorkflows, ...workflowNames])];
  }

  const ctx = getMcpPredicateContext();

  const registryState = await applyWorkflowSelectionFromManifest(nextWorkflows, ctx);

  return toolResponse([
    header('Manage Workflows'),
    section('Enabled Workflows', registryState.enabledWorkflows),
    statusLine('success', `Workflows enabled: ${registryState.enabledWorkflows.join(', ')}`),
  ]);
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedTool(
  manageWorkflowsSchema,
  manage_workflowsLogic,
  getDefaultCommandExecutor,
);
