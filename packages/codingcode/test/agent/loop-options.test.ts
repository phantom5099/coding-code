import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import { makeState, runAgentTurn, llmStream, pText, pEnd, endReason } from '../helpers/agent-harness.js';

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
    completeStream: vi.fn(() => llmStream(pText(opts.content ?? 'Done'), pEnd())),
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

  it('should not end with done when a pre-aborted signal is passed', async () => {
    const controller = new AbortController();
    controller.abort();

    const llm = makeCapturingLlm({ content: 'Response' });
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp', signal: controller.signal }
    );

    expect(endReason(events)).not.toBe('done');
  });
});
