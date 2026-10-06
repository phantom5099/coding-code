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
    async *sendMessage(input, { sessionId, cwd, model, signal, skills }) {
      const path = `/api/sessions/${sessionId || '_'}/messages`;
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        body: JSON.stringify({ input, cwd, model, skills }),
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
      if (!response.ok) {
        throw new ApiError(response.status, path, await parseErrorBody(response));
      }

      for await (const data of parseSseStream(response)) {
        const decoded = decodeFrame(data);
        if (!decoded.ok) {
          console.warn(`[agent-runtime] dropped frame (${decoded.reason})`, decoded.raw);
          continue;
        }
        yield decoded.frame;
      }
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
