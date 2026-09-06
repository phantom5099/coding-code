import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { makeState, runAgentTurn } from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
    },
    server: { port: 8080 },
  }),
}));

const mockState = makeState({ sessionId: 'test-sid', cwd: '/tmp', title: 'test' });

function makeCapturingLlm(opts: { content?: string } = {}) {
  const llm = {
    completeStream: vi.fn(() => ({
      stream: (async function* () {})(),
      response: Promise.resolve({
        ok: true,
        value: { content: opts.content ?? 'Done', toolCalls: [] },
      }),
    })),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

function mockHooks() {
  return {
    emit: vi.fn(() => Effect.succeed(undefined)),
    emitDecision: vi.fn(() => Effect.succeed(null)),
  } as any;
}

describe('agent runTurn loop options', () => {
  it('Step events report max from global config maxSteps', async () => {
    const llm = makeCapturingLlm();
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const stepEvents = events.filter((e: any) => e._tag === 'Step');
    expect(stepEvents.length).toBeGreaterThan(0);
    for (const s of stepEvents) {
      expect((s as any).max).toBe(5);
    }
  });

  it('should emit turn hooks agent.turn.start / agent.turn.end after stopping', async () => {
    const llm = makeCapturingLlm();
    const hooks = mockHooks();
    await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(hooks.emit).toHaveBeenCalledWith(
      'agent.turn.start',
      expect.objectContaining({ sessionId: mockState.sessionId })
    );
    expect(hooks.emit).toHaveBeenCalledWith(
      'agent.turn.end',
      expect.objectContaining({ sessionId: mockState.sessionId, status: 'done' })
    );
  });

  it('should not produce Done when a pre-aborted signal is passed', async () => {
    const controller = new AbortController();
    controller.abort();

    const llm = makeCapturingLlm({ content: 'Response' });
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp', signal: controller.signal }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(false);
  });
});
