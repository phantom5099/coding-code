import { Effect } from 'effect';
import { sendMessage } from '../../agent/agent.js';
import { ApprovalWaitService } from '../../approval/async-confirm.js';
import { parseApprovalResponse } from '../../approval/response.js';
import { ContextService } from '../../context/context.js';
import { AppLayer } from '../../layer.js';
import type { StreamChunk } from '../types.js';
import { agentEventToStreamChunk } from '../direct.js';
import { getWorkspaceCwd } from '../../core/workspace.js';

export interface AgentRuntimeClient {
  sendMessage(
    input: string,
    options: { sessionId?: string; cwd: string }
  ): AsyncGenerator<StreamChunk>;

  sendApprovalResponse(input: {
    sessionId: string;
    approvalId: string;
    response: string;
  }): Promise<void>;

  compact(input: { sessionId: string; cwd: string }): Promise<void>;
}

export function createDirectAgentClient(
  llm: any,
  runWithLayer: <T>(eff: any) => Promise<T>
): AgentRuntimeClient {
  return {
    async *sendMessage(input, { sessionId, cwd }) {
      const program = sendMessage(sessionId || undefined, input, cwd, llm);
      const { stream: agentGen, sessionId: resolvedSessionId } = (await runWithLayer(
        program
      )) as any;

      yield { type: 'session_id', sessionId: resolvedSessionId };

      let notify:
        | ((req: {
            type: 'approval_request';
            id: string;
            tool: string;
            args: Record<string, unknown>;
          }) => void)
        | null = null;
      const { registerEmitter, unregisterEmitter } =
        await import('../../approval/async-confirm.js');
      registerEmitter(resolvedSessionId, (id, tool, args) => {
        notify?.({ type: 'approval_request', id, tool, args });
      });

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();

        while (true) {
          const approvalPromise = new Promise<{
            type: 'approval_request';
            id: string;
            tool: string;
            args: Record<string, unknown>;
          }>((resolve) => {
            notify = resolve;
          });

          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({
              tag: 'chunk',
              value: c,
            })),
            approvalPromise.then((req): { tag: 'approval'; value: typeof req } => ({
              tag: 'approval',
              value: req,
            })),
          ]);

          if (winner.tag === 'chunk') {
            notify = null;
            if (winner.value.done) break;
            yield winner.value.value;
            pending = gen.next();
          } else {
            yield winner.value;
          }
        }
      } finally {
        unregisterEmitter(resolvedSessionId);
      }
    },

    async sendApprovalResponse({ sessionId, approvalId, response }) {
      const result = parseApprovalResponse(response);
      await runWithLayer(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          return yield* svc.resolveConfirm(approvalId, sessionId, result);
        })
      );
    },

    async compact({ sessionId, cwd }) {
      await runWithLayer(
        Effect.gen(function* () {
          const ctx = yield* ContextService;
          return yield* ctx.compress(sessionId, cwd, null);
        })
      );
    },
  };
}
