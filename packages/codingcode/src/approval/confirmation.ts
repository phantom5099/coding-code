import { Effect } from 'effect';
import type { PermissionRule } from './types.js';
import { ApprovalWaitService } from './async-confirm.js';

export type ConfirmResult =
  | { type: 'allow' }
  | { type: 'deny' }
  | { type: 'always'; rule: PermissionRule }
  | { type: 'never'; rule: PermissionRule };

export function userConfirmAsync(
  tool: string,
  args: Record<string, unknown>,
  sessionId: string,
  callId: string,
  payload?: Record<string, unknown>
): Effect.Effect<ConfirmResult, never, ApprovalWaitService> {
  return Effect.gen(function* () {
    const waitSvc = yield* ApprovalWaitService;
    const id = callId;

    yield* waitSvc.emitApprovalRequest(sessionId, id, tool, args, payload);

    return yield* waitSvc.waitForConfirm(id, sessionId);
  });
}
