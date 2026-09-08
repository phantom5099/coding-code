import { Effect } from 'effect';
import { AgentService } from '../agent/port.js';
import { ApprovalWaitService } from '../approval/wait-port.js';
import { parseApprovalResponse } from '../approval/response.js';
import { ContextService } from '../context/port.js';
import { SessionService } from '../session/port.js';
import { CheckpointService } from '../checkpoint/port.js';
import { computePaths } from '../core/path.js';
import type { StreamChunk } from '../client/types.js';
import { agentEventToStreamChunk } from '../agent/stream-adapter.js';
import type { AppRuntime } from '../layer.js';
import type { LLMClient } from '../llm/client.js';

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

  getCheckpoints(cwd: string): Promise<Array<{ turnId: number; files: string[] }>>;
  getCheckpointDiff(
    cwd: string,
    turnId?: number
  ): Promise<import('../checkpoint/types.js').CheckpointDiff>;
  revertCheckpointFiles(
    cwd: string,
    turnId: number,
    files: string[]
  ): Promise<any>;
  previewRollbackDiff(
    cwd: string,
    throughTurnId: number
  ): Promise<any>;
  rollbackCodeToTurn(
    cwd: string,
    throughTurnId: number
  ): Promise<any>;
  rollbackContext(
    cwd: string,
    throughTurnId: number
  ): Promise<{
    turns: Array<{ id: string; items: object[]; status: string }>;
    rollbackState: any;
  }>;
  rollbackBothToTurn(
    cwd: string,
    throughTurnId: number
  ): Promise<{
    turns: Array<{ id: string; items: object[]; status: string }>;
    codeResult: import('../checkpoint/types.js').CodeRollbackResult;
    rollbackState: any;
  }>;
  undoLastCodeRollback(
    cwd: string,
    force?: boolean,
    files?: string[]
  ): Promise<any>;
  getRollbackState(cwd: string): Promise<any>;
  forkSession(
    cwd: string,
    atTurnId?: number
  ): Promise<{
    sessionId: string;
    turns: Array<{ id: string; items: object[]; status: string }>;
  }>;
}

export function createDirectAgentClient(llm: LLMClient, rt: AppRuntime): AgentRuntimeClient {
  let currentSessionId = '';

  return {
    async *sendMessage(input, { sessionId, cwd }) {
      const runOpts: any = { cwd };
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
      currentSessionId = resolvedSessionId;

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
          const session = yield* SessionService;
          const context = yield* ContextService;
          const state = yield* session.load(cwd, sessionId);
          return yield* Effect.promise(() =>
            context.compactWithLLM(computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath, llm.modelInfo.maxTokens, null)
          );
        })
      );
    },

    async getCheckpoints(cwd: string) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.getCheckpoints(cwd, currentSessionId);
        })
      );
    },

    async getCheckpointDiff(cwd: string, turnId?: number) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.getCheckpointDiff(cwd, currentSessionId, turnId);
        })
      );
    },

    async revertCheckpointFiles(cwd: string, turnId: number, files: string[]) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.revertCheckpointFiles(cwd, currentSessionId, turnId, files);
        })
      );
    },

    async previewRollbackDiff(cwd: string, throughTurnId: number) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.previewRollbackDiff(cwd, currentSessionId, throughTurnId);
        })
      );
    },

    async rollbackCodeToTurn(cwd: string, throughTurnId: number) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.rollbackCodeToTurn(cwd, currentSessionId, throughTurnId);
        })
      );
    },

    async rollbackContext(cwd: string, throughTurnId: number) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, currentSessionId);
          yield* session.rollbackToTurn(state, throughTurnId, 'user rollback');
          const turns = yield* session.readUITurns(currentSessionId, cwd);
          const rollbackState: any = {
            context: { active: true, currentThroughTurnId: throughTurnId },
            code: {
              canUndoLast: false,
              lastEntry: null,
              revertedFiles: [],
              lastEntryId: null,
            },
          };
          return { turns, rollbackState };
        })
      );
    },

    async rollbackBothToTurn(cwd: string, throughTurnId: number): Promise<any> {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const checkpoint = yield* CheckpointService;
          const state = yield* session.load(cwd, currentSessionId);
          const codeResult = yield* checkpoint.rollbackCodeToTurn(
            cwd,
            currentSessionId,
            throughTurnId
          );
          yield* session.rollbackToTurn(state, throughTurnId, 'user rollback');
          const turns = yield* session.readUITurns(currentSessionId, cwd);
          const rollbackState: any = {
            context: { active: true, currentThroughTurnId: throughTurnId },
            code: {
              canUndoLast: false,
              lastEntry: null,
              revertedFiles: [],
              lastEntryId: null,
            },
          };
          return { turns, codeResult, rollbackState };
        })
      );
    },

    async undoLastCodeRollback(cwd: string, force?: boolean, files?: string[]) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.undoLastCodeRollback(cwd, currentSessionId, {
            force,
            files,
          });
        })
      );
    },

    async getRollbackState(cwd: string) {
      return rt.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const entry = yield* checkpoint.getLatestRestoreEntry(cwd, currentSessionId);
          return {
            context: { active: false, currentThroughTurnId: null },
            code: {
              canUndoLast: entry !== null,
              lastEntry: entry,
              revertedFiles: entry?.selectedFiles ?? [],
              lastEntryId: entry?.id ?? null,
            },
          };
        })
      );
    },

    async forkSession(cwd: string, atTurnId?: number) {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(cwd, currentSessionId);
          const newSessionId = yield* session.forkSession(state, atTurnId ?? 0);
          const turns = yield* session.readUITurns(newSessionId, cwd);
          return { sessionId: newSessionId, turns };
        })
      );
    },
  };
}
