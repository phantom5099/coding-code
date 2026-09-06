import { describe, it, expect, vi } from 'vitest';
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

const mockState = makeState({ sessionId: 'type-test', cwd: '/tmp', title: 'type-test' });

describe('agent runTurn smoke (hooks deps wiring)', () => {
  it('should build & run via AgentService.runTurn with mocked deps', async () => {
    const llm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve({ ok: true, value: { content: 'Hello' } }),
      })),
      modelInfo: { maxTokens: 1000 },
    } as any;

    const turnEndCalls: any[] = [];
    const hooks = {
      emit: vi.fn((point: string, payload: any) => {
        if (point === 'agent.turn.end') turnEndCalls.push(payload);
        return Effect.succeed(undefined);
      }),
      emitDecision: () => Effect.succeed(null),
    } as any;

    const { events } = await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'type-test', cwd: '/tmp' }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
    expect(turnEndCalls).toHaveLength(1);
    expect(turnEndCalls[0].status).toBe('done');
  });
});
