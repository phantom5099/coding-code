import type { StreamChunk } from '../types.js';
import { parseSseStream } from '../sse.js';
import type { createRequestHelpers } from './request.js';

export interface AgentRuntimeClient {
  sendMessage(
    input: string,
    options: { sessionId?: string; cwd: string; signal?: AbortSignal }
  ): AsyncGenerator<StreamChunk>;

  sendApprovalResponse(input: {
    sessionId: string;
    approvalId: string;
    response: string;
  }): Promise<void>;
  compact(input: { sessionId: string; cwd: string }): Promise<void>;

  getCheckpoints(): Promise<Array<{ turnId: number; title: string; files: string[] }>>;
  getCheckpointDiff(turnId?: number): Promise<import('../../checkpoint/types.js').CheckpointDiff>;
  revertCheckpointFiles(
    turnId: number,
    files: string[]
  ): Promise<import('../../checkpoint/types.js').CodeRollbackResult>;
  previewRollbackDiff(
    throughTurnId: number
  ): Promise<import('../../checkpoint/types.js').RollbackPreviewDiff>;
  rollbackCodeToTurn(
    throughTurnId: number
  ): Promise<import('../../checkpoint/types.js').CodeRollbackResult>;
  rollbackContext(
    throughTurnId: number
  ): Promise<{
    turns: Array<{ id: string; items: object[]; status: string }>;
    rollbackState: import('../../checkpoint/types.js').RollbackState;
  }>;
  rollbackBothToTurn(throughTurnId: number): Promise<{
    turns: Array<{ id: string; items: object[]; status: string }>;
    codeResult: import('../../checkpoint/types.js').CodeRollbackResult;
    rollbackState: import('../../checkpoint/types.js').RollbackState;
  }>;
  undoLastCodeRollback(
    force?: boolean,
    files?: string[]
  ): Promise<import('../../checkpoint/types.js').CodeRollbackUndoResult>;
  getRollbackState(): Promise<import('../../checkpoint/types.js').RollbackState>;
  forkSession(
    atTurnId?: number
  ): Promise<{
    sessionId: string;
    turns: Array<{ id: string; items: object[]; status: string }>;
  }>;
}

export function createHttpAgentClient(
  baseUrl: string,
  request: ReturnType<typeof createRequestHelpers>
): AgentRuntimeClient {
  const { apiPost, apiGet } = request;

  return {
    async *sendMessage(input, { sessionId, cwd, signal }) {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId || '_'}/messages`, {
        method: 'POST',
        body: JSON.stringify({ input, cwd }),
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      for await (const data of parseSseStream(response)) {
        switch (data.type) {
          case 'session_id':
            yield { type: 'session_id', sessionId: data.sessionId as string };
            break;
          case 'turn_id':
            yield { type: 'turn_id', turnId: data.turnId as number };
            break;
          case 'text':
            yield {
              type: 'text',
              text: data.text as string,
              messageId: data.messageId as number | undefined,
            };
            break;
          case 'message':
            yield {
              type: 'message',
              id: data.id as number,
              content: data.content as string,
              partial: false,
            };
            break;
          case 'approval_request':
            yield {
              type: 'approval_request',
              id: data.id as string,
              tool: data.tool as string,
              args: data.args as Record<string, unknown>,
            };
            break;
          case 'plan_ready':
            yield {
              type: 'plan_ready',
              sessionId: data.sessionId as string,
              title: data.title as string,
            };
            break;
          case 'tool_start':
            yield {
              type: 'tool_start',
              id: data.id as string,
              name: data.name as string,
              args: data.args as Record<string, unknown>,
            };
            break;
          case 'tool_result':
            yield {
              type: 'tool_result',
              id: data.id as string,
              name: data.name as string,
              output: data.output as string,
              ok: data.ok as boolean,
            };
            break;
          case 'tool_denied':
            yield {
              type: 'tool_denied',
              id: data.id as string,
              name: data.name as string,
              reason: data.reason as string,
            };
            break;
          case 'todo_update':
            yield { type: 'todo_update', items: data.items as any };
            break;
          case 'usage':
            yield {
              type: 'usage',
              prompt: data.prompt as number,
              completion: data.completion as number,
              total: data.total as number,
            };
            break;
          case 'reactive_compact':
            yield {
              type: 'reactive_compact',
              released: data.released as number,
              promptEstimate: data.promptEstimate as number,
            };
            break;
          case 'error':
            yield { type: 'error', message: data.message as string, code: data.code as string };
            return;
          case 'done':
            break;
          case 'complete':
            return;
        }
      }
    },

    async sendApprovalResponse({ sessionId, approvalId, response }) {
      await apiPost(`/api/sessions/${sessionId}/approval/${approvalId}`, { response });
    },

    async compact({ sessionId, cwd }) {
      await apiPost(`/api/sessions/${sessionId}/compact`, { cwd });
    },

    async getCheckpoints() {
      return apiGet('/api/checkpoints');
    },

    async getCheckpointDiff(turnId?: number) {
      const segment = turnId != null ? String(turnId) : 'latest';
      return apiGet(`/api/sessions/_/checkpoints/${segment}/diff?cwd=_`);
    },

    async revertCheckpointFiles(turnId: number, files: string[]) {
      return apiPost(`/api/sessions/_/checkpoints/latest/revert-files?cwd=_`, {
        turnId,
        files,
      });
    },

    async previewRollbackDiff(throughTurnId: number) {
      return apiGet(`/api/sessions/_/rollback-preview?cwd=_&throughTurnId=${throughTurnId}`);
    },

    async rollbackCodeToTurn(throughTurnId: number) {
      return apiPost(`/api/sessions/_/rollback-code-to-turn?cwd=_`, { throughTurnId });
    },

    async rollbackContext(throughTurnId: number) {
      return apiPost(`/api/sessions/_/rollback-context?cwd=_`, { throughTurnId });
    },

    async rollbackBothToTurn(throughTurnId: number) {
      return apiPost(`/api/sessions/_/rollback-both-to-turn?cwd=_`, { throughTurnId });
    },

    async undoLastCodeRollback(force?: boolean, files?: string[]) {
      return apiPost(`/api/sessions/_/undo-code-rollback?cwd=_`, { force, files });
    },

    async getRollbackState() {
      return apiGet('/api/sessions/_/rollback-state?cwd=_');
    },

    async forkSession(atTurnId?: number) {
      return apiPost('/api/sessions/_/fork?cwd=_', { atTurnId });
    },
  };
}
