import { expect, it, describe, vi } from 'vitest';
import { Effect } from 'effect';
import {
  makeState,
  runAgentTurn,
  llmStream,
  pText,
  pEnd,
  endOf,
  endReason,
} from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 100,
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

/** LLM 每次只返回纯文本、无工具调用；记录每次收到 messages 参数。 */
function makeContentOnlyLlm() {
  const seenMessages: any[][] = [];
  const llm = {
    completeStream: vi.fn((params: any) => {
      seenMessages.push(params.messages ?? []);
      return llmStream(pText('Response'), pEnd());
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, seenMessages };
}

function makeStopDecision(decision: any) {
  const emitDecision = vi.fn((point: string) =>
    point === 'agent.turn.stop' ? Effect.succeed(decision) : Effect.succeed(null)
  );
  return emitDecision;
}

describe('agent runTurn stop hook', () => {
  it('should continue iteration when stop hook returns continue decision', async () => {
    const { llm, seenMessages } = makeContentOnlyLlm();
    const emitDecision = makeStopDecision({ decision: 'continue', injection: 'Run again' });
    const hooks = { emit: vi.fn(() => Effect.succeed(undefined)), emitDecision } as any;

    const { events } = await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(emitDecision).toHaveBeenCalledWith(
      'agent.turn.stop',
      expect.objectContaining({ sessionId: mockState.sessionId })
    );
    // 限制为 2 次续跑：continue 三次后触发 AGENT_LOOP_DETECTED（共 3 次 LLM 调用）
    expect(seenMessages).toHaveLength(3);
    expect(endReason(events)).not.toBe('done');
  });

  it('should respect maxStopContinuations limit from global config', async () => {
    const { llm } = makeContentOnlyLlm();
    const emitDecision = makeStopDecision({ decision: 'continue', injection: 'Continue' });
    const hooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision,
    } as any;

    const { events } = await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const end = endOf(events);
    expect(end?.reason).toBe('error');
    if (end?.reason === 'error') {
      expect(end.error.code).toBe('AGENT_LOOP_DETECTED');
    }
    expect(endReason(events)).not.toBe('done');
    expect(hooks.emit).toHaveBeenCalledWith(
      'agent.turn.end',
      expect.objectContaining({ status: 'error' })
    );
  });

  it('should not continue if stop hook returns null', async () => {
    const { llm, seenMessages } = makeContentOnlyLlm();
    const hooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn(() => Effect.succeed(null)),
    } as any;

    const { events } = await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(seenMessages).toHaveLength(1);
    expect(endReason(events)).toBe('done');
  });

  it('should record the injection message from the stop decision', async () => {
    const { llm } = makeContentOnlyLlm();
    const recordSystem = vi.fn(() => Effect.succeed({}));
    const emitDecision = makeStopDecision({
      decision: 'continue',
      injection: 'Custom injection message',
    });
    const hooks = { emit: vi.fn(() => Effect.succeed(undefined)), emitDecision } as any;

    await runAgentTurn(
      { llm, state: mockState, hooks, session: { recordSystem } },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const contents = recordSystem.mock.calls.map((c: any) => c[1] as string);
    expect(contents.some((c) => c === 'Custom injection message')).toBe(true);
  });

  it('should use default injection if stop decision does not provide one', async () => {
    const { llm } = makeContentOnlyLlm();
    const recordSystem = vi.fn(() => Effect.succeed({}));
    const emitDecision = makeStopDecision({ decision: 'continue' });
    const hooks = { emit: vi.fn(() => Effect.succeed(undefined)), emitDecision } as any;

    await runAgentTurn(
      { llm, state: mockState, hooks, session: { recordSystem } },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const contents = recordSystem.mock.calls.map((c: any) => c[1] as string);
    expect(contents.some((c) => c === '(continue)')).toBe(true);
  });
});
