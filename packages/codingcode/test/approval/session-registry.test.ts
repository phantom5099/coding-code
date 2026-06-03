import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import {
  registerSessionApproval,
  unregisterSessionApproval,
  updateSessionPermissionMode,
} from '../../src/approval/session-registry.js';
import type { PermissionMode } from '../../src/approval/types.js';

describe('session-registry', () => {
  beforeEach(() => {
    // Clean up any leftover registrations
    for (const key of Array.from((globalThis as any).__testForks?.keys() ?? [])) {
      unregisterSessionApproval(key);
    }
  });

  it('updateSessionPermissionMode returns false for unregistered session', () => {
    expect(updateSessionPermissionMode('nonexistent', 'bypass')).toBe(false);
  });

  it('updateSessionPermissionMode returns true for registered session', () => {
    let receivedMode: PermissionMode | null = null;
    registerSessionApproval('test-session', {
      setPermissionMode: (mode) => {
        receivedMode = mode;
      },
    });
    expect(updateSessionPermissionMode('test-session', 'bypass')).toBe(true);
    expect(receivedMode).toBe('bypass');
    unregisterSessionApproval('test-session');
  });

  it('wraps Effect-returning setPermissionMode correctly', async () => {
    let currentMode: PermissionMode = 'default';
    // Simulate the real forked ApprovalService: setPermissionMode returns an Effect
    const fakeFork = {
      setPermissionMode: (mode: PermissionMode): Effect.Effect<void> =>
        Effect.sync(() => {
          currentMode = mode;
        }),
    };
    // Register with wrapper that runs the Effect (same pattern as messages.ts)
    registerSessionApproval('effect-session', {
      setPermissionMode: (m) => Effect.runPromise(fakeFork.setPermissionMode(m)),
    });

    expect(currentMode).toBe('default');
    const result = updateSessionPermissionMode('effect-session', 'bypass');
    // The wrapper returns a Promise, but updateSessionPermissionMode doesn't await it
    // We need to wait for the microtask
    expect(result).toBe(true);
    // Allow the microtask queue to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(currentMode).toBe('bypass');

    unregisterSessionApproval('effect-session');
  });

  it('unregisterSessionApproval removes the session', () => {
    registerSessionApproval('temp-session', {
      setPermissionMode: () => {},
    });
    expect(updateSessionPermissionMode('temp-session', 'plan')).toBe(true);
    unregisterSessionApproval('temp-session');
    expect(updateSessionPermissionMode('temp-session', 'plan')).toBe(false);
  });
});
