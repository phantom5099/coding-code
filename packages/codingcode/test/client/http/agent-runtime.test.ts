import { describe, it, expect, vi } from 'vitest';
import { createHttpAgentClient } from '../../../src/client/http/agent-runtime.js';
import { createRequestHelpers } from '../../../src/client/http/request.js';

function createSseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('createHttpAgentClient.sendMessage', () => {
  it('parses session_id, text, tool_start, tool_result, turn_id events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        JSON.stringify({ type: 'session_id', sessionId: 'sess-123' }),
        JSON.stringify({ type: 'turn_id', turnId: 42 }),
        JSON.stringify({ type: 'text', text: 'hello', messageId: 1 }),
        JSON.stringify({ type: 'tool_start', id: 'tc-1', name: 'bash', args: { command: 'ls' } }),
        JSON.stringify({ type: 'tool_result', id: 'tc-1', name: 'bash', output: 'file.txt', ok: true }),
        JSON.stringify({ type: 'done' }),
        JSON.stringify({ type: 'complete' }),
      ]),
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const chunks: any[] = [];
    for await (const chunk of client.sendMessage('hi', { sessionId: 'sess-123', cwd: '/tmp' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'session_id', sessionId: 'sess-123' },
      { type: 'turn_id', turnId: 42 },
      { type: 'text', text: 'hello', messageId: 1 },
      { type: 'tool_start', id: 'tc-1', name: 'bash', args: { command: 'ls' } },
      { type: 'tool_result', id: 'tc-1', name: 'bash', output: 'file.txt', ok: true },
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: 'hi', cwd: '/tmp' }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('uses "_" placeholder when sessionId is undefined', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        JSON.stringify({ type: 'session_id', sessionId: 'new-sess' }),
        JSON.stringify({ type: 'complete' }),
      ]),
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const chunks: any[] = [];
    for await (const chunk of client.sendMessage('hi', { cwd: '/tmp' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: 'session_id', sessionId: 'new-sess' }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/_/messages',
      expect.any(Object),
    );

    fetchSpy.mockRestore();
  });

  it('throws on error event', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        JSON.stringify({ type: 'error', message: 'something broke' }),
      ]),
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    await expect(async () => {
      for await (const _ of client.sendMessage('hi', { sessionId: 's', cwd: '/tmp' })) {
        // consume
      }
    }).rejects.toThrow('something broke');

    fetchSpy.mockRestore();
  });
});
