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
}

export function createHttpAgentClient(
  baseUrl: string,
  request: ReturnType<typeof createRequestHelpers>
): AgentRuntimeClient {
  const { apiPost } = request;

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
              payload: data.payload as Record<string, unknown> | undefined,
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
  };
}
