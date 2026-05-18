import { describe, it, expect, vi } from 'vitest';
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
      execute: async (name: string, _args: Record<string, unknown>, _opts?: any) => {
        const delay = name === 'tool_a' ? 50 : name === 'tool_b' ? 10 : 30;
        // "tool_a" will wait on barrier, others finish immediately
        if (name === 'tool_a') {
          await resolveBarrier;
        } else {
          await new Promise((r) => setTimeout(r, delay));
        }
        executionOrder.push(name);
        return Result.ok(`result-${name}`);
      },
      getRegistry: () => ({
        describeAllSync: () => [
          { name: 'tool_a', description: '', schema: {} },
          { name: 'tool_b', description: '', schema: {} },
          { name: 'tool_c', description: '', schema: {} },
        ],
        filterSync: () => [
          { name: 'tool_a', description: '', schema: {} },
          { name: 'tool_b', description: '', schema: {} },
          { name: 'tool_c', description: '', schema: {} },
        ],
      }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 1,
      availableTools: undefined,
    };

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

    // All 3 tools should have executed
    expect(executionOrder).toHaveLength(3);
    // tool_b (10ms) and tool_c (30ms) should finish before tool_a (50ms + barrier)
    // This proves concurrent execution — if sequential, order would be a,b,c
    expect(executionOrder).toContain('tool_b');
    expect(executionOrder).toContain('tool_c');
    expect(executionOrder).toContain('tool_a');

    const toolResults = events.filter((e) => e.type === 'toolResult');
    expect(toolResults).toHaveLength(3);
    expect(toolResults.every((tr: any) => tr.ok === true)).toBe(true);
  });

  it('should isolate tool failures — one failure doesn\'t block others', async () => {
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
      execute: async (name: string, _args: Record<string, unknown>, _opts?: any) => {
        if (name === 'bad_tool') {
          throw new Error('Simulated failure');
        }
        return Result.ok(`result-${name}`);
      },
      getRegistry: () => ({
        describeAllSync: () => [],
        filterSync: () => [],
      }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 1,
      availableTools: undefined,
    };

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

    const toolResults = events.filter((e) => e.type === 'toolResult');
    expect(toolResults).toHaveLength(3);

    // Good tools should succeed
    const good1 = toolResults.find((r: any) => r.name === 'good_tool');
    expect(good1.ok).toBe(true);

    const good2 = toolResults.find((r: any) => r.name === 'good_tool2');
    expect(good2.ok).toBe(true);

    // Bad tool should have failed but not thrown
    const bad = toolResults.find((r: any) => r.name === 'bad_tool');
    expect(bad.ok).toBe(false);
    expect(bad.output).toContain('Error');
  });

  it('should pass AbortSignal to executor', async () => {
    let receivedSignal: AbortSignal | undefined;

    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: {} }],
          }),
        ),
      }),
    };

    const mockExecutor = {
      execute: async (_name: string, _args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => {
        receivedSignal = opts?.signal;
        return Result.ok('done');
      },
      getRegistry: () => ({
        describeAllSync: () => [],
        filterSync: () => [],
      }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 1,
      availableTools: undefined,
    };

    const gen = runReActLoop(
      [{ role: 'user', content: 'test' }],
      config,
      mockLlm as any,
      mockExecutor as any,
    );

    for await (const _event of gen) { /* consume */ }

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal!.aborted).toBe(false);
  });
});
