import * as readline from 'node:readline';
import { Effect } from 'effect';
import type { PermissionRule } from './types.js';
import { ApprovalWaitService } from './async-confirm.js';

export type ConfirmResult =
  | { type: 'allow' }
  | { type: 'deny' }
  | { type: 'always'; rule: PermissionRule }
  | { type: 'never'; rule: PermissionRule };

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (ans) => resolve(ans.trim().toLowerCase()));
    });
  } finally {
    rl.close();
  }
}

function buildResult(answer: string, tool: string): ConfirmResult {
  switch (answer) {
    case 'y':
      return { type: 'allow' };
    case 'n':
      return { type: 'deny' };
    case 'a':
      return {
        type: 'always',
        rule: {
          id: `user-allow-${tool}-${Date.now()}`,
          action: 'allow',
          toolPattern: tool,
          reason: 'User always allows',
          source: 'user',
        },
      };
    case 'r':
      return {
        type: 'never',
        rule: {
          id: `user-deny-${tool}-${Date.now()}`,
          action: 'deny',
          toolPattern: tool,
          reason: 'User never allows',
          source: 'user',
        },
      };
    default:
      return { type: 'deny' };
  }
}

export function userConfirm(
  tool: string,
  args: Record<string, unknown>,
  mode: 'interactive' | 'default-deny' = 'default-deny'
): Effect.Effect<ConfirmResult> {
  if (mode === 'default-deny') {
    return Effect.succeed({ type: 'deny' } as ConfirmResult);
  }

  return Effect.gen(function* () {
    const serializedArgs = Object.entries(args)
      .map(([k, v]) => `  ${k}: ${String(v).slice(0, 200)}`)
      .join('\n');

    const question = `\n[Approval] Tool "${tool}" wants to run:\n${serializedArgs}\nAllow? (Y)es / (N)o / (A)lways / Neve_r / (V)iew full: `;

    const answer = yield* Effect.promise(() => promptUser(question));

    if (answer === 'v') {
      console.log('\nFull arguments:', JSON.stringify(args, null, 2));
      const result = yield* userConfirm(tool, args, 'interactive');
      return result;
    }

    return buildResult(answer, tool);
  });
}

/**
 * Async confirmation via SSE: sends an approval request to the TUI client
 * and waits for the response via Effect.async + Deferred.
 * @param waitSvc injected as parameter to keep R channel clean.
 */
export function userConfirmAsync(
  tool: string,
  args: Record<string, unknown>,
  waitSvc: ApprovalWaitService,
  sessionId: string,
  callId?: string
): Effect.Effect<ConfirmResult> {
  return Effect.gen(function* () {
    const id = callId!;

    yield* waitSvc.emitApprovalRequest(sessionId, id, tool, args);

    // Suspend until resolveConfirm is called
    return yield* waitSvc.waitForConfirm(id, sessionId);
  });
}
