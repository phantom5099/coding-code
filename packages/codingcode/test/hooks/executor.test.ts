import { describe, it, expect } from 'vitest';
import { setHookRuntimeEnabled, isHookRuntimeEnabled } from '../../src/hooks/executor.js';

describe('hook runtime enabled toggle', () => {
  it('should default to enabled', () => {
    expect(isHookRuntimeEnabled('my-hook')).toBe(true);
  });

  it('should disable a hook by name', () => {
    setHookRuntimeEnabled('my-hook', false);
    expect(isHookRuntimeEnabled('my-hook')).toBe(false);
  });

  it('should re-enable a hook', () => {
    setHookRuntimeEnabled('my-hook', true);
    expect(isHookRuntimeEnabled('my-hook')).toBe(true);
  });

  it('should not affect other hooks', () => {
    setHookRuntimeEnabled('hook-a', false);
    setHookRuntimeEnabled('hook-b', true);
    expect(isHookRuntimeEnabled('hook-a')).toBe(false);
    expect(isHookRuntimeEnabled('hook-b')).toBe(true);
  });
});
