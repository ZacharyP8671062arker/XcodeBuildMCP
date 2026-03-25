import { sessionStore } from '../../../utils/session-store.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, detailTree, statusLine } from '../../../utils/tool-event-builders.ts';

export const schema = {};

export const handler = async (): Promise<ToolResponse> => {
  const current = sessionStore.getAll();
  const activeProfile = sessionStore.getActiveProfile();

  const items = Object.entries(current)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ label: k, value: String(v) }));

  if (items.length === 0) {
    return toolResponse([
      header('Show Defaults'),
      statusLine(
        'info',
        `No session defaults are set. Active profile: ${activeProfile ?? 'global'}`,
      ),
    ]);
  }

  return toolResponse([
    header('Show Defaults', [{ label: 'Active Profile', value: activeProfile ?? 'global' }]),
    detailTree(items),
  ]);
};
