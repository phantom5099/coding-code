import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import { sendMessage, resumeSession } from '../orchestrate.js';
import { SessionService } from '../session/store.js';
import { ContextService } from '../context/context.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { AppLayer } from '../layer.js';

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

function parseApprovalResponse(resp: string) {
  switch (resp) {
    case 'allow': return { type: 'allow' as const };
    case 'deny': return { type: 'deny' as const };
    case 'always': return {
      type: 'always' as const,
      rule: { id: `user-allow-${Date.now()}`, action: 'allow' as const, toolPattern: '*', reason: 'User always allows', source: 'user' as const },
    };
    case 'never': return {
      type: 'never' as const,
      rule: { id: `user-deny-${Date.now()}`, action: 'deny' as const, toolPattern: '*', reason: 'User never allows', source: 'user' as const },
    };
    default: return { type: 'deny' as const };
  }
}

export async function createDirectClient(llm: any): Promise<AgentClient> {
  let state: any = null;
  let currentSessionId = '';

  const runWithLayer = <T,>(eff: any): Promise<T> =>
    Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));

  const initResult = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(process.cwd(), 'unknown', '0.1.0');
    }),
  );
  state = initResult;
  currentSessionId = (initResult as any).sessionId;

  return {
    getSessionId() {
      return currentSessionId;
    },

    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const program = sendMessage(state, input, llm);
      const agentGen = await runWithLayer(program) as AsyncGenerator<AgentEvent, any, unknown>;
      yield* agentEventToStreamChunk(agentGen);
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
      const result = await runWithLayer(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const st = yield* svc.create(process.cwd(), 'unknown', '0.1.0', sid);
          return st;
        }),
      );
      state = result;
      currentSessionId = (result as any).sessionId;
      return runWithLayer(resumeSession(state, process.cwd()));
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
      try {
        const response = await fetch('http://localhost:8080/api/models');
        return response.json();
      } catch {
        return [];
      }
    },

    async switchModel(id: string) {
      try {
        await fetch('http://localhost:8080/api/models/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: id }),
        });
      } catch {
        // Model switching via HTTP — server may not be available in direct mode
      }
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
