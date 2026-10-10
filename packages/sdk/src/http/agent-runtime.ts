import type { AgentRuntimeClient } from '../contracts.js';
import { decodeFrame } from '../decode.js';
import { ApiError } from '../error.js';
import { parseSseStream } from '../sse.js';
import { parseErrorBody } from './request.js';
import type { createRequestHelpers } from './request.js';

export function createHttpAgentClient(
  baseUrl: string,
  request: ReturnType<typeof createRequestHelpers>
): AgentRuntimeClient {
  const { apiPost } = request;

  return {
    async submitInput(input, { sessionId, inputId, cwd, model, signal, skills }) {
      const path = `/api/sessions/${sessionId || '_'}/messages`;
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        body: JSON.stringify({ input, inputId, cwd, model, skills }),
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
      if (!response.ok) {
        throw new ApiError(response.status, path, await parseErrorBody(response));
      }

      // 202：输入已并入活跃回合，没有流可读
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        const body = (await response.json()) as { sessionId: string; turnId: number };
        return { kind: 'queued', sessionId: body.sessionId, turnId: body.turnId };
      }

      const stream = (async function* () {
        for await (const data of parseSseStream(response)) {
          const decoded = decodeFrame(data);
          if (!decoded.ok) {
            console.warn(`[agent-runtime] dropped frame (${decoded.reason})`, decoded.raw);
            continue;
          }
          yield decoded.frame;
        }
      })();
      return { kind: 'turn', stream };
    },

    async sendApprovalResponse({ sessionId, approvalId, response }) {
      await apiPost(`/api/sessions/${sessionId}/approval/${approvalId}`, { response });
    },

    compact({ sessionId, cwd, model }) {
      return apiPost(`/api/sessions/${sessionId}/compact`, { cwd, model });
    },
  };
}

export type { AgentRuntimeClient };
