import { describe, it, expect } from 'vitest';
import { makeState, runAgentTurn } from '../helpers/agent-harness.js';
import { agentEventToStreamChunk } from '../../src/agent/stream-adapter.js';
import { agentEventToSseEvent, toSseEvents } from '../../src/server/adapter.js';

function makePlainLlm(content = 'ok') {
  return {
    completeStream: () => ({
      stream: (async function* () {
        yield content;
      })(),
      response: Promise.resolve({ ok: true, value: { content, toolCalls: [] } }),
    }),
    complete: () => Promise.resolve({ content, toolCalls: [] }),
    modelInfo: { provider: 'mock', model: 'mock', maxTokens: 1000 },
  } as any;
}

describe('ContextCompressed', () => {
  it('emits ContextCompressed when assemblePayload reports compression', async () => {
    const { events } = await runAgentTurn(
      {
        llm: makePlainLlm(),
        state: makeState(),
        contextAssemble: async () => ({
          messages: [{ role: 'user', content: 'hi' }],
          compressed: true,
          released: 4321,
          promptEstimate: 999,
        }),
      },
      { sessionId: 'sid', cwd: '/tmp' }
    );
    const compressed = events.filter((e: any) => e._tag === 'ContextCompressed');
    expect(compressed).toHaveLength(1);
    expect(compressed[0]).toMatchObject({ released: 4321, promptEstimate: 999 });
  });

  it('does not emit ContextCompressed when assemblePayload reports no compression', async () => {
    const { events } = await runAgentTurn(
      {
        llm: makePlainLlm(),
        state: makeState(),
      },
      { sessionId: 'sid', cwd: '/tmp' }
    );
    expect(events.filter((e: any) => e._tag === 'ContextCompressed')).toHaveLength(0);
  });
});

describe('ContextCompressed adapters', () => {
  const event = {
    _tag: 'ContextCompressed',
    released: 500,
    promptEstimate: 1200,
  } as any;

  it('agentEventToStreamChunk maps to context_compressed chunk', async () => {
    const chunks: any[] = [];
    for await (const c of agentEventToStreamChunk((async function* () {
      yield event;
    })() as any)) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'context_compressed', released: 500, promptEstimate: 1200 }]);
  });

  it('agentEventToSseEvent maps to context_compressed SSE event', () => {
    expect(agentEventToSseEvent(event)).toEqual({
      type: 'context_compressed',
      released: 500,
      promptEstimate: 1200,
    });
  });

  it('toSseEvents forwards context_compressed', async () => {
    const out: any[] = [];
    for await (const e of toSseEvents((async function* () {
      yield event;
    })() as any)) {
      out.push(e);
    }
    expect(out).toEqual([{ type: 'context_compressed', released: 500, promptEstimate: 1200 }]);
  });
});
