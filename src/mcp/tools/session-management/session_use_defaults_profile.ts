import * as z from 'zod';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { persistActiveSessionDefaultsProfile } from '../../../utils/config-store.ts';
import { sessionStore } from '../../../utils/session-store.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';

const schemaObj = z.object({
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Activate a named session defaults profile (example: ios or watch).'),
  global: z.boolean().optional().describe('Activate the global unnamed defaults profile.'),
  persist: z
    .boolean()
    .optional()
    .describe('Persist activeSessionDefaultsProfile to .xcodebuildmcp/config.yaml.'),
});

type Params = z.input<typeof schemaObj>;

function formatActiveProfileLabel(activeProfile: string | null): string {
  return activeProfile ?? 'global defaults';
}

function resolveProfileToActivate(params: Params): string | null | undefined {
  if (params.global === true) return null;
  if (params.profile === undefined) return undefined;
  return params.profile.trim();
}

export async function sessionUseDefaultsProfileLogic(params: Params): Promise<ToolResponse> {
  const notices: string[] = [];
  const errorHeader = header('Use Defaults Profile');

  if (params.global === true && params.profile !== undefined) {
    return toolResponse([
      errorHeader,
      statusLine('error', 'Provide either global=true or profile, not both.'),
    ]);
  }

  const profileToActivate = resolveProfileToActivate(params);

  if (typeof profileToActivate === 'string') {
    if (profileToActivate.length === 0) {
      return toolResponse([errorHeader, statusLine('error', 'Profile name cannot be empty.')]);
    }
    if (!sessionStore.listProfiles().includes(profileToActivate)) {
      return toolResponse([
        errorHeader,
        statusLine('error', `Profile "${profileToActivate}" does not exist.`),
      ]);
    }
  }

  if (profileToActivate !== undefined) {
    sessionStore.setActiveProfile(profileToActivate);
  }

  const active = sessionStore.getActiveProfile();
  if (params.persist) {
    const { path } = await persistActiveSessionDefaultsProfile(active);
    notices.push(`Persisted active profile selection to ${path}`);
  }

  const activeLabel = formatActiveProfileLabel(active);
  const profiles = sessionStore.listProfiles();
  const current = sessionStore.getAll();

  const events: PipelineEvent[] = [
    header('Use Defaults Profile', [
      { label: 'Active Profile', value: activeLabel },
      { label: 'Known Profiles', value: profiles.length > 0 ? profiles.join(', ') : '(none)' },
    ]),
  ];

  const items = Object.entries(current)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ label: k, value: String(v) }));
  if (items.length > 0) {
    events.push(detailTree(items));
  }

  if (notices.length > 0) {
    events.push(section('Notices', notices));
  }

  events.push(statusLine('success', `Active profile: ${activeLabel}`));

  return toolResponse(events);
}

export const schema = schemaObj.shape;

export const handler = createTypedTool(
  schemaObj,
  sessionUseDefaultsProfileLogic,
  getDefaultCommandExecutor,
);
