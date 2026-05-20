import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage, resumeSession } from '../orchestration/index.js';
import { SessionService } from '../session/store.js';
import { ContextService } from '../context/context.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { parseApprovalResponse } from '../approval/response.js';
import { AppLayer } from '../layer.js';
import { getActiveEntry, getLLMClient, listModels, switchModel as switchActiveModel } from '../llm/factory.js';

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
      const program = sendMessage(currentSessionId || undefined, input, process.cwd(), activeLlm);
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
          return yield* resumeSession(sid, process.cwd());
        }),
      );
    },

    async listSessions() {
      return runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.listSessions();
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
  };
}
