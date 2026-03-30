import * as z from 'zod';
import { sessionStore } from '../../../utils/session-store.ts';
import { sessionDefaultKeys } from '../../../utils/session-defaults-schema.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { toolResponse } from '../../../utils/tool-response.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { formatProfileLabel, formatProfileAnnotation } from './session-format-helpers.ts';

const keys = sessionDefaultKeys;

const schemaObj = z.object({
  keys: z.array(z.enum(keys)).optional(),
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Clear defaults for this named profile instead of the active profile.'),
  all: z
    .boolean()
    .optional()
    .describe(
      'Clear all defaults across global and named profiles. Cannot be combined with keys/profile.',
    ),
});

type Params = z.infer<typeof schemaObj>;

export async function sessionClearDefaultsLogic(params: Params): Promise<ToolResponse> {
  if (params.all) {
    if (params.profile !== undefined || params.keys !== undefined) {
      return toolResponse([
        header('Clear Defaults'),
        statusLine('error', 'all=true cannot be combined with profile or keys.'),
      ]);
    }

    sessionStore.clearAll();
    return toolResponse([
      header('Clear Defaults'),
      statusLine('success', 'All session defaults cleared.'),
    ]);
  }

  const profile = params.profile?.trim();
  if (profile !== undefined) {
    if (profile.length === 0) {
      return toolResponse([
        header('Clear Defaults'),
        statusLine('error', 'Profile name cannot be empty.'),
      ]);
    }

    if (!sessionStore.listProfiles().includes(profile)) {
      return toolResponse([
        header('Clear Defaults'),
        statusLine('error', `Profile "${profile}" does not exist.`),
      ]);
    }

    if (params.keys) {
      sessionStore.clearForProfile(profile, params.keys);
    } else {
      sessionStore.clearForProfile(profile);
    }

    return toolResponse([
      header('Clear Defaults', [{ label: 'Profile', value: profile }]),
      statusLine('success', `Session defaults cleared for profile "${profile}".`),
    ]);
  }

  const currentActiveProfile = sessionStore.getActiveProfile();

  if (params.keys) {
    sessionStore.clear(params.keys);
  } else {
    sessionStore.clear();
  }

  const profileAnnotation = formatProfileAnnotation(currentActiveProfile);
  return toolResponse([
    header('Clear Defaults', [
      { label: 'Profile', value: formatProfileLabel(currentActiveProfile) },
    ]),
    statusLine('success', `Session defaults cleared ${profileAnnotation}`),
  ]);
}

export const schema = schemaObj.shape;

export const handler = createTypedTool(
  schemaObj,
  sessionClearDefaultsLogic,
  getDefaultCommandExecutor,
);
