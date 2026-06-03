import { describe, expect, it, vi } from 'vitest';
import { createDirectClient, agentEventToStreamChunk } from '../../src/client/direct.js';
import { registerEmitter, unregisterEmitter } from '../../src/approval/async-confirm.js';

const noopLlm = {
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true, value: { content: '' } }),
  }),
};

describe('createDirectClient model operations', () => {
  it('lists models from the local model catalog without HTTP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm);

    const result = await client.listModels();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.models.length).toBeGreaterThan(0);
    // activeId is null when no activeModel is set in config
    expect(result.activeId === null || typeof result.activeId === 'string').toBe(true);

    fetchSpy.mockRestore();
  });

  it('rejects unknown model switches without contacting server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm);

    await expect(client.switchModel('missing-model@MISSING_KEY')).rejects.toThrow('not found');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('agentEventToStreamChunk - approval interleaving', () => {
  it('yields approval_request chunks without blocking on subsequent events', async () => {
    async function* source() {
      yield { _tag: 'LlmChunk' as const, text: 'before' };
      yield {
        _tag: 'ApprovalRequest' as const,
        id: 'apr-1',
        tool: 'bash',
        args: { command: 'ls' },
      };
      yield { _tag: 'LlmChunk' as const, text: 'after' };
      yield { _tag: 'Done' as const, content: 'done' };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ type: 'text', text: 'before', messageId: 0 });
    expect(chunks[1]).toEqual({
      type: 'approval_request',
      id: 'apr-1',
      tool: 'bash',
      args: { command: 'ls' },
    });
    expect(chunks[2]).toEqual({ type: 'text', text: 'after', messageId: 0 });
    expect(chunks[3]).toEqual({ type: 'done' });
  });

  it('yields multiple sequential approval_request chunks', async () => {
    async function* source() {
      yield { _tag: 'ApprovalRequest' as const, id: 'apr-1', tool: 'bash', args: {} };
      yield { _tag: 'ApprovalRequest' as const, id: 'apr-2', tool: 'write_file', args: {} };
      yield { _tag: 'Done' as const, content: '' };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({ type: 'approval_request', id: 'apr-1' });
    expect(chunks[1]).toMatchObject({ type: 'approval_request', id: 'apr-2' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('yields usage chunks', async () => {
    async function* source() {
      yield { _tag: 'Step' as const, step: 1, max: 10 };
      yield { _tag: 'Assistant' as const, content: 'ok' };
      yield { _tag: 'Usage' as const, prompt: 1000, completion: 500, total: 1500 };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'message', id: 1, content: 'ok', partial: false },
      { type: 'usage', prompt: 1000, completion: 500, total: 1500 },
    ]);
  });
});
