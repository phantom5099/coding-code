import { Effect } from 'effect';
import { ApprovalWaitService } from './wait-port.js';
import { EventSinkService } from '@codingcode/sink';
import type { ApprovalAction, ApprovalTarget } from './types.js';

export type ConfirmResult = { readonly type: 'allow' } | { readonly type: 'deny' };

export interface UserConfirmRequest {
  readonly target: ApprovalTarget;
  readonly sessionId: string;
  readonly action: ApprovalAction;
}

export function userConfirmAsync(
  req: UserConfirmRequest
): Effect.Effect<ConfirmResult, never, ApprovalWaitService | EventSinkService> {
  const { target, sessionId, action } = req;
  return Effect.gen(function* () {
    const waitSvc = yield* ApprovalWaitService;
    const sink = yield* EventSinkService;

    yield* sink.emit(sessionId, {
      family: 'event',
      event: {
        type: 'approval_request',
        id: target.id,
        tool: target.name,
        action,
        arguments: target.arguments,
      },
    });

    return yield* waitSvc.waitForConfirm({ callId: target.id, sessionId });
  });
}

export function parseApprovalResponse(response: string): ConfirmResult {
  return response === 'allow' ? { type: 'allow' } : { type: 'deny' };
}
