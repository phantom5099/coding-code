import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage, resumeSession } from '../orchestration/index.js';
import { SessionService } from '../session/store.js';
import { ContextService } from '../context/context.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { parseApprovalResponse } from '../approval/response.js';
import { AppLayer } from '../layer.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { getActiveEntry, getLLMClient, listModels, switchModel as switchActiveModel } from '../llm/factory.js';
import { getWorkspaceCwd } from '../core/workspace.js';

export type StreamChunk = string | { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> };

export interface AgentClient {
  sendMessage(input: string): AsyncGenerator<StreamChunk>;
  sendApprovalResponse(id: string, response: string): Promise<void>;
  resumeSession(sid: string): Promise<any>;
  listSessions(): Promise<any[]>;
  listModels(): Promise<any>;
  switchModel(id: string): Promise<void>;
  getSessionId(): string;
  clearSession(): Promise<void>;
  classifyLastCompletedChanges(): Promise<{ agentModified: string[]; unknownSource: string[] } | null>;
  revertLastCompleted(mode: 'agent' | 'all'): Promise<void>;
  revertCheckpoint(turnId: number, mode: 'agent' | 'all'): Promise<void>;
  forwardLastRevert(): Promise<void>;
  hasForwardStack(): Promise<boolean>;
  getCheckpoints(): Promise<Array<{ turnId: number; title: string; agentModified: string[]; unknownSource: string[] }>>;
}

export async function* agentEventToStreamChunk(
  source: AsyncGenerator<AgentEvent, any, unknown>,
): AsyncGenerator<StreamChunk, void, unknown> {
  for await (const event of source) {
    switch (event._tag) {
      case 'LlmChunk':
        yield event.text;
        break;
      case 'ToolStart':
        yield `\n[Using: ${event.name}]\n`;
        break;
      case 'ToolDenied':
        yield `\n[Denied: ${event.name}] ${event.reason}\n`;
        break;
      case 'ApprovalRequest':
        yield { type: 'approval_request', id: event.id, tool: event.tool, args: event.args };
        break;
    }
  }
}

export async function createDirectClient(llm: any): Promise<AgentClient> {
  let currentSessionId = '';
  let activeLlm = llm;

  const runWithLayer = <T,>(eff: any): Promise<T> =>
    Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));

  return {
    getSessionId() {
      return currentSessionId;
    },

    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const { registerEmitter, unregisterEmitter } = await import('../approval/async-confirm.js');
      const program = sendMessage(currentSessionId || undefined, input, getWorkspaceCwd(), activeLlm);
      const { stream: agentGen, sessionId } = await runWithLayer(program) as any;
      currentSessionId = sessionId;

      let notify: ((req: { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }) => void) | null = null;
      registerEmitter(sessionId, (id, tool, args) => {
        notify?.({ type: 'approval_request', id, tool, args });
      });

      try {
        const gen = agentEventToStreamChunk(agentGen);
        let pending = gen.next();

        while (true) {
          const approvalPromise = new Promise<{ type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }>((resolve) => {
            notify = resolve;
          });

          const winner = await Promise.race([
            pending.then((c): { tag: 'chunk'; value: IteratorResult<StreamChunk, void> } => ({ tag: 'chunk', value: c })),
            approvalPromise.then((req): { tag: 'approval'; value: typeof req } => ({ tag: 'approval', value: req })),
          ]);

          if (winner.tag === 'chunk') {
            notify = null;
            if (winner.value.done) break;
            yield winner.value.value;
            pending = gen.next();
          } else {
            yield winner.value;
            const resumed = await pending;
            if (resumed.done) break;
            yield resumed.value;
            pending = gen.next();
          }
        }
      } finally {
        unregisterEmitter(sessionId);
      }
    },

    async sendApprovalResponse(id: string, response: string) {
      const result = parseApprovalResponse(response);
      await runWithLayer(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          return yield* svc.resolveConfirm(id, currentSessionId, result);
        }),
      );
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      return runWithLayer(
        Effect.gen(function* () {
          return yield* resumeSession(sid, getWorkspaceCwd());
        }),
      );
    },

    async listSessions() {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.listSessions(getWorkspaceCwd());
        }),
      );
    },

    async listModels() {
      const modelsResult = listModels();
      if (!modelsResult.ok) throw modelsResult.error;
      const activeResult = getActiveEntry();
      if (!activeResult.ok) throw activeResult.error;
      return { models: modelsResult.value, activeId: activeResult.value.id };
    },

    async switchModel(id: string) {
      const switchResult = switchActiveModel(id);
      if (!switchResult.ok) throw switchResult.error;
      const clientResult = await getLLMClient();
      if (!clientResult.ok) throw clientResult.error;
      activeLlm = clientResult.value;
    },

    async clearSession() {
      await runWithLayer(
        Effect.gen(function* () {
          const ctx = yield* ContextService;
          yield* ctx.clear(currentSessionId);
        }),
      );
    },

    async classifyLastCompletedChanges() {
      if (!currentSessionId) return null;
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const turnIds = checkpoint.getCompletedTurns(projectPath, currentSessionId);
          if (turnIds.length === 0) return null;
          const lastTurn = turnIds[turnIds.length - 1];
          if (lastTurn === undefined) return null;
          return checkpoint.classifyChanges(projectPath, currentSessionId, lastTurn);
        }),
      );
    },

    async revertLastCompleted(mode: 'agent' | 'all') {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const turnIds = checkpoint.getCompletedTurns(projectPath, currentSessionId);
          if (turnIds.length === 0) return;
          const lastTurn = turnIds[turnIds.length - 1];
          if (lastTurn === undefined) return;
          const changes = checkpoint.classifyChanges(projectPath, currentSessionId, lastTurn);
          if (!changes) return;

          const files = mode === 'agent' ? changes.agentModified : [...changes.agentModified, ...changes.unknownSource];
          if (files.length > 0) {
            checkpoint.revertFiles(projectPath, currentSessionId, lastTurn, files);
          }
        }),
      );
    },

    async revertCheckpoint(turnId: number, mode: 'agent' | 'all') {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          const projectPath = getWorkspaceCwd();
          const changes = checkpoint.classifyChanges(projectPath, currentSessionId, turnId);
          if (!changes) return;
          const files = mode === 'agent' ? changes.agentModified : [...changes.agentModified, ...changes.unknownSource];
          if (files.length > 0) {
            checkpoint.revertFiles(projectPath, currentSessionId, turnId, files);
          }
        }),
      );
    },

    async forwardLastRevert() {
      if (!currentSessionId) return;
      await runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          checkpoint.forward(getWorkspaceCwd(), currentSessionId);
        }),
      );
    },

    async hasForwardStack() {
      if (!currentSessionId) return false;
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.hasForwardStack(getWorkspaceCwd(), currentSessionId);
        }),
      );
    },


    async getCheckpoints() {
      if (!currentSessionId) return [];
      return runWithLayer(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.getCheckpoints(getWorkspaceCwd(), currentSessionId);
        }),
      );
    },
  };
}
