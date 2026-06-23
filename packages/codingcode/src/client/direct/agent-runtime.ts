import { Effect } from 'effect';
import { sendMessage } from '../../agent/agent.js';
import { ApprovalWaitService } from '../../approval/async-confirm.js';
import { parseApprovalResponse } from '../../approval/response.js';
import { ContextService } from '../../context/service.js';
import { HookService } from '../../hooks/registry.js';
import { SessionService } from '../../session/store.js';
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

      let notifyApproval: ((req: StreamChunk) => void) | null = null;
      let notifyPlan: ((req: StreamChunk) => void) | null = null;
      const waitService = await rt.runPromise(
        Effect.gen(function* () {
          return yield* ApprovalWaitService;
        })
      );
      const hookService = await rt.runPromise(
        Effect.gen(function* () {
          return yield* HookService;
        })
      );
      Effect.runSync(
        waitService.registerEmitter(
          resolvedSessionId,
          (
            id: string,
            tool: string,
            args: Record<string, unknown>,
            payload?: Record<string, unknown>
          ) => {
            notifyApproval?.({ type: 'approval_request', id, tool, args, payload });
          }
        )
      );
      const unregisterPlanReady = Effect.runSync(
        hookService.register('plan.ready', (payload) => {
          const p = payload as {
            sessionId?: string;
            title?: string;
          };
          if (p.sessionId !== resolvedSessionId) return;
          notifyPlan?.({
            type: 'plan_ready',
            sessionId: p.sessionId ?? '',
            title: p.title ?? '',
          });
        })
      );

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();
        let currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
          notifyApproval = resolve;
        });
        let currentPlanPromise = new Promise<StreamChunk>((resolve) => {
          notifyPlan = resolve;
        });

        while (true) {
          const approvalPromise = currentApprovalPromise;
          const planPromise = currentPlanPromise;
          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({
              tag: 'chunk',
              value: c,
            })),
            approvalPromise.then((req): { tag: 'approval'; value: StreamChunk } => ({
              tag: 'approval',
              value: req,
            })),
            planPromise.then((req): { tag: 'plan'; value: StreamChunk } => ({
              tag: 'plan',
              value: req,
            })),
          ]);

          if (winner.tag === 'chunk') {
            if (winner.value.done) break;
            yield winner.value.value;
            currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
              notifyApproval = resolve;
            });
            currentPlanPromise = new Promise<StreamChunk>((resolve) => {
              notifyPlan = resolve;
            });
            pending = gen.next();
          } else if (winner.tag === 'approval') {
            yield winner.value;
            currentApprovalPromise = new Promise<StreamChunk>((resolve) => {
              notifyApproval = resolve;
            });
          } else {
            yield winner.value;
            currentPlanPromise = new Promise<StreamChunk>((resolve) => {
              notifyPlan = resolve;
            });
          }
        }
      } finally {
        unregisterPlanReady();
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
          const session = yield* SessionService;
          const context = yield* ContextService;
          const state = yield* session.load(cwd, sessionId);
          return yield* Effect.promise(() =>
            context.compactWithLLM(state.transcriptPath, llm.modelInfo.maxTokens, null)
          );
        })
      );
    },
  };
}
