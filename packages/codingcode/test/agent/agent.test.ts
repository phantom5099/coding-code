import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import type { AgentEvent } from '../../src/agent/types.js';
import { makeState, runAgentTurn, type HarnessMocks } from '../helpers/agent-harness.js';

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

function okResponse(content: string, toolCalls?: any[]) {
  return Promise.resolve({ ok: true, value: { content, toolCalls } });
}

function makeCapturingLlm(opts: { content?: string; toolCalls?: any[]; stream?: string[] }) {
  const calls: any[] = [];
  const llm = {
    completeStream: vi.fn(() => {
      calls.push({});
      return {
        stream: (async function* () {
          for (const c of opts.stream ?? []) yield c;
        })(),
        response: okResponse(opts.content ?? 'Hello world', opts.toolCalls),
      };
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, calls };
}

describe('agent runTurn loop', () => {
  it('should yield text chunks from LLM stream', async () => {
    const { llm } = makeCapturingLlm({ content: 'Hello world', stream: ['Hello', ' ', 'world'] });
    const { events } = await runAgentTurn({ llm, state: mockState }, { sessionId: 'test-sid', cwd: '/tmp' });

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['Hello', ' ', 'world']);
  });

  it('should handle empty LLM stream gracefully', async () => {
    const { llm } = makeCapturingLlm({ content: '' });
    const { events } = await runAgentTurn({ llm, state: mockState }, { sessionId: 'test-sid', cwd: '/tmp' });

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents).toHaveLength(0);
    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should surface tool results as ToolResult events', async () => {
    let callCount = 0;
    const llm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            stream: (async function* () {})(),
            response: okResponse('', [
              { id: 'tc1', name: 'execute_command', arguments: { command: 'git status' } },
            ]),
          };
        }
        return { stream: (async function* () {})(), response: okResponse('done') };
      }),
      modelInfo: { maxTokens: 1000 },
    } as any;
    const executor = {
      executeBatch: (calls: any[]) =>
        Effect.succeed(
          calls.map((tc: any) => ({
            type: 'ok' as const,
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

    const toolResults = events.filter(
      (e: AgentEvent): e is Extract<AgentEvent, { _tag: 'ToolResult' }> => e._tag === 'ToolResult'
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.output).toBe('On branch main\nnothing to commit');
    expect(toolResults[0]!.ok).toBe(true);
  });

  it('should forward text markers from LLM stream', async () => {
    let callCount = 0;
    const llm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            stream: (async function* () {
              yield '\n[Using: readFile]\n';
            })(),
            response: okResponse('', [
              { id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } },
            ]),
          };
        }
        return { stream: (async function* () {})(), response: okResponse('done') };
      }),
      modelInfo: { maxTokens: 1000 },
    } as any;
    const { events } = await runAgentTurn(
      { llm, state: mockState },
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });

  it('should yield a single maxSteps error and a single turn.end hook when maxSteps is exhausted', async () => {
    // LLM always requests a tool call → the loop never reaches a natural stop.
    const llm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {
          yield 'calling tool';
        })(),
        response: okResponse('', [{ id: 'tc1', name: 'read_file', arguments: { path: 'x' } }]),
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
      { sessionId: 'test-sid', cwd: '/tmp' }
    );

    const maxStepErrors = events.filter(
      (e: any) => e._tag === 'Error' && e.error?.code === 'MAX_STEPS_REACHED'
    );
    expect(maxStepErrors).toHaveLength(1);
    expect(turnEndCalls).toHaveLength(1);
    expect(turnEndCalls[0].status).toBe('maxSteps');
  });
});
