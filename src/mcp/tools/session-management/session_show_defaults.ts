import { sessionStore } from '../../../utils/session-store.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, section } from '../../../utils/tool-event-builders.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import {
  formatProfileLabel,
  buildFullDetailTree,
  formatDetailLines,
} from './session-format-helpers.ts';

export const schema = {};

export async function handler(): Promise<ToolResponse> {
  const namedProfiles = sessionStore.listProfiles();
  const profileKeys: Array<string | null> = [null, ...namedProfiles];

  const events: PipelineEvent[] = [header('Show Defaults')];

  for (const profileKey of profileKeys) {
    const defaults = sessionStore.getAllForProfile(profileKey);
    const label = `\u{1F4C1} ${formatProfileLabel(profileKey)}`;
    const items = buildFullDetailTree(defaults);
    events.push(section(label, formatDetailLines(items)));
  }

  return toolResponse(events);
}
