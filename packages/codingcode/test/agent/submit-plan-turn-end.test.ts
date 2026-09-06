import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { makeState, runAgentTurn } from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: { compactionModel: '' },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
    },
    server: { port: 8080 },
  }),
}));

const mockState = makeState({ sessionId: 'test-session', cwd: '/tmp', title: 'test' });

function okResponse(content: string, toolCalls?: any[]) {
  return Promise.resolve({ ok: true, value: { content, toolCalls } });
}

/** LLM 先调用一次 submit_plan，再以纯文本收尾。 */
function makeSubmitPlanLlm() {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return {
          stream: (async function* () {})(),
          response: okResponse('', [
            {
              id: 'tc-1',
              name: 'submit_plan',
              arguments: { title: 'My Plan', plan_content: '## Goal\nfix bug' },
            },
          ]),
        };
      }
      return {
        stream: (async function* () {})(),
        response: okResponse('Plan is ready for your review.'),
      };
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

function makeOkExecutor() {
  return {
    executeBatch: (calls: any[]) =>
      Effect.succeed(
        calls.map((tc: any) => ({
          type: 'ok' as const,
          id: tc.id,
          name: tc.name,
          output: 'Plan written to /tmp/plans/my-plan.md',
        }))
      ),
  } as any;
}

function makePlanReadyHooks() {
  const planReadyEmits: any[] = [];
  const hooks = {
    emit: vi.fn((point: string, payload: any) => {
      if (point === 'plan.ready') planReadyEmits.push(payload);
      return Effect.succeed(undefined);
    }),
    emitDecision: vi.fn(() => Effect.succeed(null)),
  } as any;
  return { hooks, planReadyEmits };
}

describe('agent runTurn plan.ready emission on turn-end', () => {
  it('emits plan.ready when turn ends naturally after submit_plan tool call', async () => {
    const { hooks, planReadyEmits } = makePlanReadyHooks();
    const { events } = await runAgentTurn(
      { llm: makeSubmitPlanLlm(), state: mockState, hooks, executor: makeOkExecutor() },
      { sessionId: 'test-session', cwd: '/tmp' }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
    expect(planReadyEmits).toHaveLength(1);
    expect(planReadyEmits[0]).toEqual({
      sessionId: mockState.sessionId,
      projectPath: mockState.cwd,
      title: 'My Plan',
    });
  });

  it('does NOT emit plan.ready when no submit_plan was called this turn', async () => {
    const { hooks, planReadyEmits } = makePlanReadyHooks();
    const llm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: okResponse('Just a regular response'),
      })),
      modelInfo: { maxTokens: 1000 },
    } as any;

    const { events } = await runAgentTurn(
      { llm, state: mockState, hooks },
      { sessionId: 'test-session', cwd: '/tmp' }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
    expect(planReadyEmits).toHaveLength(0);
  });

  it('does NOT switch profile after plan.ready (profile change is UI responsibility)', async () => {
    const setActiveProfile = vi.fn(() => Effect.void);
    const { hooks } = makePlanReadyHooks();

    const { events } = await runAgentTurn(
      {
        llm: makeSubmitPlanLlm(),
        state: mockState,
        hooks,
        executor: makeOkExecutor(),
        sessionPort: { setActiveProfile },
      },
      { sessionId: 'test-session', cwd: '/tmp' }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
    expect(setActiveProfile).not.toHaveBeenCalled();
  });
});
