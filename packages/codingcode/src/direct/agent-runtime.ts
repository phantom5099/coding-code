import { Effect } from 'effect';
import { AgentService } from '../agent/port.js';
import { ApprovalWaitService } from '../approval/wait-port.js';
import { parseApprovalResponse } from '../approval/confirmation.js';
import { ContextService } from '../context/port.js';
import { SessionService } from '../session/port.js';
import type { SessionShape } from '../session/port.js';
import { computePaths } from '../core/path.js';
import type { AgentRuntimeClient } from '../client/contracts.js';
import type { FrameBody } from '../contracts/frame.js';
import { createFrameAssembler } from '../contracts/frame-io.js';
import type { AppRuntime } from '../layer.js';
import type { LLMClient } from '../contracts/provider.js';

// 只读 / 只写权限模式所需的最小面
type SessionStatePort = Pick<SessionShape, 'load' | 'setPermissionMode'>;

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

      const assembler = createFrameAssembler({ sessionId: resolvedSessionId });

      let notifyApproval: ((body: FrameBody) => void) | null = null;
      const waitService = await rt.runPromise(
        Effect.gen(function* () {
          return yield* ApprovalWaitService;
        })
      );
      Effect.runSync(
        waitService.registerEmitter(
          resolvedSessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            notifyApproval?.({ family: 'event', event: { type: 'approval_request', id, tool, args } });
          }
        )
      );

      try {
        let pending = agentGen.next();
        let currentApprovalPromise = new Promise<FrameBody>((resolve) => {
          notifyApproval = resolve;
        });

        while (true) {
          const approvalPromise = currentApprovalPromise;
          const winner = await Promise.race([
            pending.then((c): { tag: 'body'; value: IteratorResult<FrameBody, void> } => ({
              tag: 'body',
              value: c,
            })),
            approvalPromise.then((body): { tag: 'approval'; value: FrameBody } => ({
              tag: 'approval',
              value: body,
            })),
          ]);

          if (winner.tag === 'body') {
            if (winner.value.done) break;
            yield assembler.stamp(winner.value.value);
            currentApprovalPromise = new Promise<FrameBody>((resolve) => {
              notifyApproval = resolve;
            });
            pending = agentGen.next();
          } else {
            yield assembler.stamp(winner.value);
            currentApprovalPromise = new Promise<FrameBody>((resolve) => {
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
