import { Effect } from 'effect';
import { AgentService } from '../agent/port.js';
import { ApprovalWaitService } from '../approval/wait-port.js';
import { parseApprovalResponse } from '../approval/confirmation.js';
import { ContextService } from '../context/port.js';
import { SessionService } from '../session/port.js';
import type { SessionStatePort } from '../session/port.js';
import { computePaths } from '../core/path.js';
import type { AgentRuntimeClient } from '../client/contracts.js';
import type { StreamChunk } from '../client/types.js';
import { agentEventToStreamChunk } from '../agent/stream-adapter.js';
import type { AppRuntime } from '../layer.js';
import type { LLMClient } from '../llm/client.js';

export function createDirectAgentClient(llm: LLMClient, rt: AppRuntime): AgentRuntimeClient {
  return {
    async *sendMessage(input, { sessionId, cwd }) {
      const runOpts: { cwd: string; activeProfile?: 'build'; permissionMode?: 'default' } = { cwd };
      if (!sessionId) {
        runOpts.activeProfile = 'build';
        runOpts.permissionMode = 'default';
      }
      const { stream: agentGen, sessionId: resolvedSessionId } = await rt.runPromise(
        Effect.gen(function* () {
          const agent = yield* AgentService;
          return yield* agent.runTurn(input, { sessionId: sessionId || undefined, ...runOpts });
        })
      );

      yield { type: 'session_id', sessionId: resolvedSessionId };

      let notifyApproval: ((req: StreamChunk) => void) | null = null;
      const waitService = await rt.runPromise(
        Effect.gen(function* () {
          return yield* ApprovalWaitService;
        })
      );
      Effect.runSync(
        waitService.registerEmitter(
          resolvedSessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            notifyApproval?.({ type: 'approval_request', id, tool, args });
          }
        )
      );

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();
        let currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
          notifyApproval = resolve;
        });

        while (true) {
          const approvalPromise = currentApprovalPromise;
          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({
              tag: 'chunk',
              value: c,
            })),
            approvalPromise.then((req): { tag: 'approval'; value: StreamChunk } => ({
              tag: 'approval',
              value: req,
            })),
          ]);

          if (winner.tag === 'chunk') {
            if (winner.value.done) break;
            yield winner.value.value;
            currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
              notifyApproval = resolve;
            });
            pending = gen.next();
          } else {
            yield winner.value;
            currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
              notifyApproval = resolve;
            });
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
          const session: SessionStatePort = yield* SessionService;
          const context = yield* ContextService;
          const state = yield* session.load(cwd, sessionId);
          return yield* Effect.promise(() =>
            context.compactWithLLM(
              computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath,
              llm.modelInfo.maxTokens,
              null
            )
          );
        })
      );
    },
  };
}

export type { AgentRuntimeClient };
