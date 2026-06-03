import type { PermissionMode } from './types.js';

/**
 * Registry of active session-scoped ApprovalService forks.
 * Used so that PUT /sessions/:id/permission-mode can update
 * the in-memory fork in addition to the on-disk index.
 */
interface ApprovalHandle {
  setPermissionMode: (mode: PermissionMode) => Promise<void> | void;
}

const activeForks = new Map<string, ApprovalHandle>();

export function registerSessionApproval(sessionId: string, handle: ApprovalHandle): void {
  activeForks.set(sessionId, handle);
}

export function unregisterSessionApproval(sessionId: string): void {
  activeForks.delete(sessionId);
}

export function getSessionApproval(sessionId: string): ApprovalHandle | undefined {
  return activeForks.get(sessionId);
}

export function updateSessionPermissionMode(sessionId: string, mode: PermissionMode): boolean {
  const handle = activeForks.get(sessionId);
  if (!handle) return false;
  handle.setPermissionMode(mode);
  return true;
}
