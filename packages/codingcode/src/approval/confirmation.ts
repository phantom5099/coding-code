import { Effect } from 'effect';
import type { PermissionRule } from './types.js';
import { ApprovalWaitService } from './wait-port.js';

export type ConfirmResult =
  | { type: 'allow' }
  | { type: 'deny' }
  | { type: 'always'; rule: PermissionRule }
  | { type: 'never'; rule: PermissionRule };

export function userConfirmAsync(
  tool: string,
  args: Record<string, unknown>,
  sessionId: string,
  callId: string
): Effect.Effect<ConfirmResult, never, ApprovalWaitService> {
  return Effect.gen(function* () {
    const waitSvc = yield* ApprovalWaitService;
    const id = callId;

    yield* waitSvc.emitApprovalRequest(sessionId, id, tool, args);

    return yield* waitSvc.waitForConfirm(id, sessionId);
  });
}

export function parseApprovalResponse(response: string): ConfirmResult {
  switch (response) {
    case 'allow':
      return { type: 'allow' };
    case 'deny':
      return { type: 'deny' };
    case 'always':
      return {
        type: 'always',
        rule: {
          id: `user-allow-${Date.now()}`,
          action: 'allow',
          toolPattern: '*',
          reason: 'User always allows',
          source: 'user',
        },
      };
    case 'never':
      return {
        type: 'never',
        rule: {
          id: `user-deny-${Date.now()}`,
          action: 'deny',
          toolPattern: '*',
          reason: 'User never allows',
          source: 'user',
        },
      };
    default:
      return { type: 'deny' };
  }
}
