import { describe, it, expect, vi } from 'vitest';
import { createHttpAgentClient } from '../../../src/client/http/agent-runtime.js';
import { createRequestHelpers } from '../../../src/client/http/request.js';
import type { Frame } from '../../../src/contracts/frame.js';

function createSseResponse(lines: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const ENVELOPE = { sessionId: 'sess-123', turnId: 42 };

const STREAM: Frame[] = [
  {
    ...ENVELOPE,
    seq: 1,
    family: 'transition',
    transition: { to: 'start', turnId: 42 },
  },
  { ...ENVELOPE, seq: 2, family: 'transition', transition: { to: 'executing' } },
  { ...ENVELOPE, seq: 3, family: 'event', event: { type: 'text_delta', text: 'hello' } },
  {
    ...ENVELOPE,
    seq: 4,
    family: 'event',
    event: { type: 'tool_call', id: 'tc-1', name: 'bash', args: { command: 'ls' } },
  },
  {
    ...ENVELOPE,
    seq: 5,
    family: 'transition',
    transition: { to: 'executing', responded: { usage: { prompt: 1, completion: 1, total: 2 } } },
  },
  {
    ...ENVELOPE,
    seq: 6,
    family: 'event',
    event: { type: 'tool_result', id: 'tc-1', name: 'bash', outcome: { status: 'ok', output: 'file.txt' } },
  },
  { ...ENVELOPE, seq: 7, family: 'transition', transition: { to: 'end', reason: 'done' } },
];

describe('createHttpAgentClient.sendMessage', () => {
  it('decodes frame envelopes from the SSE stream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse(STREAM));

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const frames: Frame[] = [];
    for await (const frame of client.sendMessage('hi', { sessionId: 'sess-123', cwd: '/tmp' })) {
      frames.push(frame);
    }

    expect(frames).toEqual(STREAM);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: 'hi', cwd: '/tmp' }),
      })
    );

    fetchSpy.mockRestore();
  });

  it('drops malformed frames but keeps the valid ones', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        { type: 'complete' }, // legacy / unknown shape → dropped
        { sessionId: 'sess-123', turnId: 1, seq: 1, family: 'transition', transition: { to: 'end', reason: 'done' } },
      ])
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const frames: Frame[] = [];
    for await (const frame of client.sendMessage('hi', { sessionId: 'sess-123', cwd: '/tmp' })) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(1);
    expect(frames[0]!.family).toBe('transition');

    fetchSpy.mockRestore();
  });

  it('uses "_" placeholder when sessionId is undefined', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        { sessionId: 'new-sess', turnId: null, seq: 1, family: 'fatal', fatal: { message: 'boom', code: 'X' } },
      ])
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const frames: Frame[] = [];
    for await (const frame of client.sendMessage('hi', { cwd: '/tmp' })) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(1);
    expect(frames[0]!.sessionId).toBe('new-sess');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/_/messages',
      expect.any(Object)
    );

    fetchSpy.mockRestore();
  });

  it('yields a fatal frame instead of throwing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        {
          sessionId: 's',
          turnId: null,
          seq: 1,
          family: 'fatal',
          fatal: { message: 'something broke', code: 'LLM_FAILED' },
        },
      ])
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpAgentClient('http://localhost:8080', request);

    const frames: Frame[] = [];
    for await (const c of client.sendMessage('hi', { sessionId: 's', cwd: '/tmp' })) {
      frames.push(c);
    }

    expect(frames).toHaveLength(1);
    expect(frames[0]!.family).toBe('fatal');
    if (frames[0]!.family === 'fatal') {
      expect(frames[0]!.fatal).toEqual({ message: 'something broke', code: 'LLM_FAILED' });
    }

    fetchSpy.mockRestore();
  });
});
