import { Effect } from 'effect';
import { sendMessage } from '../../agent/agent.js';
import { ApprovalWaitService } from '../../approval/async-confirm.js';
import { parseApprovalResponse } from '../../approval/response.js';
import { ContextService } from '../../context/service.js';
import type { StreamChunk } from '../types.js';
import { agentEventToStreamChunk } from '../direct.js';
import type { AppRuntime } from '../../layer.js';
import type { LLMClient } from '../../llm/client.js';

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

export function createDirectAgentClient(llm: LLMClient, rt: AppRuntime): AgentRuntimeClient {
  return {
    async *sendMessage(input, { sessionId, cwd }) {
      const program = sendMessage(sessionId || undefined, input, cwd, llm);
      const { stream: agentGen, sessionId: resolvedSessionId } = (await rt.runPromise(
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
      const waitService = await rt.runPromise(
        Effect.gen(function* () {
          return yield* ApprovalWaitService;
        })
      );
      Effect.runSync(
        waitService.registerEmitter(
          resolvedSessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            notify?.({ type: 'approval_request', id, tool, args });
          }
        )
      );

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
        Effect.runSync(waitService.unregisterEmitter(resolvedSessionId));
      }
    },

    async sendApprovalResponse({ sessionId, approvalId, response }) {
      const result = parseApprovalResponse(response);
      await rt.runPromise(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          return yield* svc.resolveConfirm(approvalId, sessionId, result);
        })
      );
    },

    async compact({ sessionId, cwd }) {
      await rt.runPromise(
        Effect.gen(function* () {
          const context = yield* ContextService;
          return yield* Effect.promise(() =>
            context.compactWithLLM(sessionId, cwd, llm.modelInfo.maxTokens, null)
          );
        })
      );
    },
  };
}
