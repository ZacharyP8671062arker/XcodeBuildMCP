import { sessionStore } from '../../../utils/session-store.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, detailTree, statusLine } from '../../../utils/tool-event-builders.ts';

export const schema = {};

function formatActiveProfileLabel(activeProfile: string | null): string {
  return activeProfile ?? 'global defaults';
}

export const handler = async (): Promise<ToolResponse> => {
  const current = sessionStore.getAll();
  const activeProfile = sessionStore.getActiveProfile();
  const activeProfileLabel = formatActiveProfileLabel(activeProfile);

  const items = Object.entries(current)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ label: k, value: String(v) }));

  if (items.length === 0) {
    return toolResponse([
      header('Show Defaults'),
      statusLine(
        'info',
        `No session defaults are set. Active profile: ${activeProfileLabel}`,
      ),
    ]);
  }

  return toolResponse([
    header('Show Defaults', [{ label: 'Active Profile', value: activeProfileLabel }]),
    detailTree(items),
  ]);
};
