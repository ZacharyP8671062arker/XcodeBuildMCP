import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler } from '../session_show_defaults.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('session-show-defaults tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  afterEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have empty schema', () => {
      expect(schema).toEqual({});
    });
  });

  describe('Handler Behavior', () => {
    it('should return empty defaults when none set', async () => {
      const result = await handler();
      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Show Defaults');
      expect(text).toContain('(default)');
      expect(text).toContain('(not set)');
    });

    it('should return current defaults when set', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme', simulatorId: 'SIM-123' });
      const result = await handler();
      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('scheme: MyScheme');
      expect(text).toContain('simulatorId: SIM-123');
    });

    it('shows defaults from the active profile', async () => {
      sessionStore.setDefaults({ scheme: 'GlobalScheme' });
      sessionStore.setActiveProfile('ios');
      sessionStore.setDefaults({ scheme: 'IOSScheme' });

      const result = await handler();
      const text = allText(result);
      expect(text).toContain('scheme: IOSScheme');
    });
  });
});
