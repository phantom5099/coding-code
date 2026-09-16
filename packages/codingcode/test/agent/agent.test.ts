import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import {
  makeState,
  runAgentTurn,
  llmStream,
  pText,
  pToolCall,
  pEnd,
  texts,
  toolResults,
  endReason,
} from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: { compactionModel: '' },
    memory: { enabled: false },
    server: { port: 8080 },
  }),
}));

const mockState = makeState({ sessionId: 'test-sid', cwd: '/tmp', title: 'test' });

function makeCapturingLlm(parts: () => AsyncIterable<any>) {
  const llm = {
    completeStream: vi.fn(() => parts()),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

describe('agent runTurn loop', () => {
  it('should yield text chunks from LLM stream', async () => {
    const llm = makeCapturingLlm(() => llmStream(pText('Hello'), pText(' '), pText('world'), pEnd()));
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(texts(events)).toEqual(['Hello', ' ', 'world']);
  });

  it('should handle empty LLM stream gracefully', async () => {
    const llm = makeCapturingLlm(() => llmStream(pEnd()));
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(texts(events)).toHaveLength(0);
    expect(endReason(events)).toBe('done');
  });

  it('should surface tool results as tool_result events', async () => {
    let callCount = 0;
    const llm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return llmStream(pToolCall('tc1', 'execute_command', { command: 'git status' }), pEnd());
        }
        return llmStream(pText('done'), pEnd());
      }),
      modelInfo: { maxTokens: 1000 },
    } as any;
    const executor = {
      prepare: () => Effect.succeed({ tools: [], lookup: () => undefined }),
      executeBatch: (calls: any[]) =>
        Effect.succeed(
          calls.map((tc: any) => ({
            status: 'ok' as const,
            id: tc.id,
            name: tc.name,
            output: 'On branch main\nnothing to commit',
          }))
        ),
    } as any;
    const { events } = await runAgentTurn(
      { llm, state: mockState, executor },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const results = toolResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toEqual({
      status: 'ok',
      output: 'On branch main\nnothing to commit',
    });
  });

  it('should forward text markers from LLM stream', async () => {
    let callCount = 0;
    const llm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return llmStream(
            pText('\n[Using: readFile]\n'),
            pToolCall('tc1', 'readFile', { path: 'test.txt' }),
            pEnd()
          );
        }
        return llmStream(pEnd());
      }),
      modelInfo: { maxTokens: 1000 },
    } as any;
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(texts(events)).toEqual(['\n[Using: readFile]\n']);
  });

  it('should end with maxSteps and emit a single turn.end hook when maxSteps is exhausted', async () => {
    // LLM always requests a tool call → the loop never reaches a natural stop.
    const llm = {
      completeStream: vi.fn(() => llmStream(pText('calling tool'), pToolCall('tc1', 'read_file', { path: 'x' }), pEnd())),
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
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    expect(endReason(events)).toBe('maxSteps');
    expect(turnEndCalls).toHaveLength(1);
    expect(turnEndCalls[0].status).toBe('maxSteps');
  });
});
