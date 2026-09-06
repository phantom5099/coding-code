import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import type { AgentEvent } from '../../src/agent/types.js';
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

const mockState = makeState({ sessionId: 'test-sid', cwd: '/tmp', title: 'concurrent' });

function okResponse(content: string, toolCalls?: any[]) {
  return Promise.resolve({ ok: true, value: { content, toolCalls } });
}

// 每个工具独立执行并把顺序记录到 executionOrder；由 executeBatch 并发驱动。
function makeConcurrentExecutor(opts: { barrierPromise?: Promise<void>; failTool?: string }) {
  const executionOrder: string[] = [];
  const executor = {
    execute: (name: string, _args: Record<string, unknown>) => {
      if (opts.failTool && name === opts.failTool) {
        return Effect.fail(new Error('Simulated failure') as any);
      }
      if (name === 'tool_a') {
        return Effect.gen(function* () {
          executionOrder.push('tool_a_start');
          yield* Effect.promise(() => opts.barrierPromise as Promise<void>);
          executionOrder.push('tool_a');
          return `result-${name}`;
        });
      }
      return Effect.sync(() => {
        executionOrder.push(name);
        return `result-${name}`;
      });
    },
    executeBatch: (toolCalls: any[]) =>
      Effect.all(
        toolCalls.map((tc: any) =>
          executor.execute(tc.name, tc.arguments ?? {}).pipe(
            (Effect.matchEffect as any)({
              onSuccess: (output: any) =>
                Effect.succeed({ type: 'ok' as const, id: tc.id, name: tc.name, output }),
              onFailure: (err: any) =>
                Effect.succeed({
                  type: 'error' as const,
                  id: tc.id,
                  name: tc.name,
                  output: String(err),
                }),
            }),
            (Effect.catchAllDefect as any)((defect: any) =>
              Effect.succeed({
                type: 'error' as const,
                id: tc.id,
                name: tc.name,
                output: String(defect),
              })
            )
          )
        ),
        { concurrency: 'unbounded' }
      ),
  };
  return { executor, executionOrder };
}

function makeToolSequenceLlm(firstToolCalls: any[]) {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return {
          stream: (async function* () {})(),
          response: okResponse('', firstToolCalls),
        };
      }
      return { stream: (async function* () {})(), response: okResponse('done') };
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

describe('agent runTurn concurrent tool execution', () => {
  it('should execute multiple tool calls concurrently', async () => {
    let releaseBarrier!: () => void;
    const barrierPromise = new Promise<void>((r) => {
      releaseBarrier = r;
    });
    const { executor, executionOrder } = makeConcurrentExecutor({ barrierPromise });

    const llm = makeToolSequenceLlm([
      { id: 'tc1', name: 'tool_a', arguments: {} },
      { id: 'tc2', name: 'tool_b', arguments: {} },
      { id: 'tc3', name: 'tool_c', arguments: {} },
    ]);

    const runPromise = runAgentTurn(
      { llm, state: mockState, executor },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    // 等 tool_a 真正开始并阻塞在屏障后，再放行 —— tool_b/tool_c 同步完成必须先于 tool_a。
    await vi.waitFor(() => expect(executionOrder).toContain('tool_a_start'), { timeout: 5000 });
    releaseBarrier();
    const { events } = await runPromise;

    expect(executionOrder).toHaveLength(4);
    expect(executionOrder[0]).toBe('tool_a_start');
    expect(executionOrder.indexOf('tool_b')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder.indexOf('tool_c')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder[executionOrder.length - 1]).toBe('tool_a');

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
  });

  it('should isolate tool failures', async () => {
    const { executor } = makeConcurrentExecutor({ failTool: 'bad_tool' });

    const llm = makeToolSequenceLlm([
      { id: 'tc1', name: 'good_tool', arguments: {} },
      { id: 'tc2', name: 'bad_tool', arguments: {} },
      { id: 'tc3', name: 'good_tool2', arguments: {} },
    ]);

    const { events } = await runAgentTurn(
      { llm, state: mockState, executor },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const toolResults = events.filter(
      (e): e is Extract<AgentEvent, { _tag: 'ToolResult' }> => e._tag === 'ToolResult'
    );
    expect(toolResults).toHaveLength(3);
    expect(toolResults.find((r) => r.name === 'good_tool')?.ok).toBe(true);
    expect(toolResults.find((r) => r.name === 'good_tool2')?.ok).toBe(true);
    expect(toolResults.find((r) => r.name === 'bad_tool')?.ok).toBe(false);
  });
});
