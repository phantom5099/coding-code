import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGlobalPermissionMode,
  setGlobalPermissionMode,
} from '../../src/approval/index.js';

describe('Global permission mode state', () => {
  beforeEach(() => {
    // Reset to default between tests
    setGlobalPermissionMode('default');
  });

  it('starts as default', () => {
    expect(getGlobalPermissionMode()).toBe('default');
  });

  it('can be set to dontAsk', () => {
    setGlobalPermissionMode('dontAsk');
    expect(getGlobalPermissionMode()).toBe('dontAsk');
  });

  it('can be set to all valid modes', () => {
    const modes = ['default', 'acceptEdits', 'dontAsk', 'plan', 'bypass'] as const;
    for (const mode of modes) {
      setGlobalPermissionMode(mode);
      expect(getGlobalPermissionMode()).toBe(mode);
    }
  });

  it('is shared across multiple reads (module-level singleton)', () => {
    setGlobalPermissionMode('plan');
    // Both reads return the same value 鈥?no per-call isolation
    expect(getGlobalPermissionMode()).toBe('plan');
    expect(getGlobalPermissionMode()).toBe('plan');
  });
});
