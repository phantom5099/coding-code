import type { AgentRuntimeClient } from '../contracts.js';
import { decodeFrame } from '../../contracts/frame-io.js';
import { parseSseStream } from '../sse.js';
import type { createRequestHelpers } from './request.js';

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

    async compact({ sessionId, cwd }) {
      await apiPost(`/api/sessions/${sessionId}/compact`, { cwd });
    },
  };
}

export type { AgentRuntimeClient };
