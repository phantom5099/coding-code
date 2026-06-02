import { describe, it, expect } from 'vitest';
import { agentEventToStreamChunk } from '../../src/client/direct.js';

describe('agentEventToStreamChunk with TodoUpdate', () => {
  it('should map TodoUpdate to todo_update chunk', async () => {
    async function* source() {
      yield { _tag: 'TodoUpdate' as const, items: [{ step: 'a', status: 'pending' as const }] };
    }

    const gen = agentEventToStreamChunk(source() as any);
    const chunks: any[] = [];
    for await (const c of gen) chunks.push(c);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'todo_update', items: [{ step: 'a', status: 'pending' }] });
  });

  it('should skip TodoUpdate when mapping with non-matching events', async () => {
    async function* source() {
      yield { _tag: 'LlmChunk' as const, text: 'hello' };
      yield { _tag: 'Step' as const, step: 1, max: 5 };
    }

    const gen = agentEventToStreamChunk(source() as any);
    const chunks: any[] = [];
    for await (const c of gen) chunks.push(c);

    const todoChunks = chunks.filter((c: any) => typeof c === 'object' && c.type === 'todo_update');
    expect(todoChunks).toHaveLength(0);
  });
});
