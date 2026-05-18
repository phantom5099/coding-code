import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from './agent.js';
import { Result } from '../core/result.js';

describe('runReActLoop — concurrent tool execution', () => {
  it('should execute multiple tool calls concurrently', async () => {
    const executionOrder: string[] = [];
    const resolveBarrier = new Promise<void>((r) => setTimeout(r, 50));

    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'tool_a', arguments: { delay: 50 } },
              { id: 'tc2', name: 'tool_b', arguments: { delay: 10 } },
              { id: 'tc3', name: 'tool_c', arguments: { delay: 30 } },
            ],
          }),
        ),
      }),
    };

    const mockExecutor = {
      execute: (name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.gen(function* () {
          if (name === 'tool_a') {
            yield* Effect.promise(() => resolveBarrier);
          } else {
            const delay = name === 'tool_b' ? 10 : 30;
            yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, delay)));
          }
          executionOrder.push(name);
          return `result-${name}`;
        }),
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = { role: 'coder', systemPrompt: 'You are a coder', maxSteps: 1, availableTools: undefined };

    const gen = runReActLoop(
      [{ role: 'user', content: 'run all tools' }],
      config,
      mockLlm as any,
      mockExecutor as any,
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(executionOrder).toHaveLength(3);
    expect(executionOrder.indexOf('tool_b')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder.indexOf('tool_c')).toBeLessThan(executionOrder.indexOf('tool_a'));

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
  });

  it('should isolate tool failures', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'good_tool', arguments: {} },
              { id: 'tc2', name: 'bad_tool', arguments: {} },
              { id: 'tc3', name: 'good_tool2', arguments: {} },
            ],
          }),
        ),
      }),
    };

    const mockExecutor = {
      execute: (name: string, _args: Record<string, unknown>, _opts?: any) =>
        name === 'bad_tool'
          ? Effect.fail(new Error('Simulated failure') as any)
          : Effect.succeed(`result-${name}`),
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = { role: 'coder', systemPrompt: 'You are a coder', maxSteps: 1, availableTools: undefined };

    const gen = runReActLoop(
      [{ role: 'user', content: 'run all' }],
      config,
      mockLlm as any,
      mockExecutor as any,
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
    expect(toolResults.find((r: any) => r.name === 'good_tool')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'good_tool2')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'bad_tool')?.ok).toBe(false);
  });
});
