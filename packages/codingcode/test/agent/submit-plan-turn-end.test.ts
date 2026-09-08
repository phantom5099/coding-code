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

function makeCapturingHooks() {
  const emittedPoints: string[] = [];
  const hooks = {
    emit: vi.fn((point: string, _payload: any) => {
      emittedPoints.push(point);
      return Effect.succeed(undefined);
    }),
    emitDecision: vi.fn(() => Effect.succeed(null)),
  } as any;
  return { hooks, emittedPoints };
}

describe('agent treats submit_plan as an ordinary tool', () => {
  it('runs submit_plan and ends the turn without any plan-specific hook events', async () => {
    const { hooks, emittedPoints } = makeCapturingHooks();
    const { events } = await runAgentTurn(
      { llm: makeSubmitPlanLlm(), state: mockState, hooks, executor: makeOkExecutor() },
      { sessionId: 'test-session', cwd: '/tmp' }
    );

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
    // plan.ready hook point has been removed — the agent no longer announces submit_plan.
    expect(emittedPoints.includes('plan.ready')).toBe(false);
    expect(emittedPoints.filter((p) => p.startsWith('plan.'))).toHaveLength(0);
  });

  it('does NOT switch profile after submit_plan (profile change is UI responsibility)', async () => {
    const setActiveProfile = vi.fn(() => Effect.void);
    const { hooks } = makeCapturingHooks();

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
