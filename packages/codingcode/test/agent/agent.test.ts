import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';

const mockToolRegistry = {
  describeAll: () => [],
  filter: () => [],
  get: () => null,
  register: () => Effect.succeed(undefined),
};

describe('runReActLoop', () => {
  it('should yield text chunks from LLM stream', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield 'Hello';
          yield ' ';
          yield 'world';
        })(),
        response: Promise.resolve(
          Result.ok({ content: 'Hello world' }),
        ),
      }),
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('done'),
    };

    const maxSteps = 25;

    const gen = runReActLoop(
      [{ role: 'user', content: 'hi' }],
      maxSteps,
      mockLlm as any,
      mockExecutor as any,
      mockToolRegistry as any,
      'test-session',
      1,
      '/tmp',
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['Hello', ' ', 'world']);
  });

  it('should handle empty LLM stream gracefully', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      }),
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('done'),
    };

    const maxSteps = 25;

    const gen = runReActLoop(
      [{ role: 'user', content: 'hi' }],
      maxSteps,
      mockLlm as any,
      mockExecutor as any,
      mockToolRegistry as any,
      'test-session',
      1,
      '/tmp',
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents).toHaveLength(0);
  });

  it('should feed bash tool results back to LLM (regression: result was discarded)', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: execute_command]\n';
        })(),
        response: Promise.resolve(Result.ok({
          content: '',
          toolCalls: [{ id: 'tc1', name: 'execute_command', arguments: { command: 'git status' } }],
        })),
      }),
    };

    const toolRegistryWithBash = {
      describeAll: () => [
        { name: 'execute_command', description: 'Run shell command', parameters: { type: 'object' } },
      ],
      filter: () => [],
      get: () => null,
      register: () => Effect.succeed(undefined),
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('On branch main\nnothing to commit'),
      executeBatch: (toolCalls: any[]) =>
        Effect.succeed(
          toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: 'On branch main\nnothing to commit' })),
        ),
    };

    const maxSteps = 1;

    const gen = runReActLoop(
      [{ role: 'user', content: 'git status' }],
      maxSteps,
      mockLlm as any,
      mockExecutor as any,
      toolRegistryWithBash as any,
      'test-session',
      1,
      '/tmp',
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].output).toBe('On branch main\nnothing to commit');
    expect(toolResults[0].ok).toBe(true);
  });

  it('should forward tool-call markers from LLM stream', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: readFile]\n';
        })(),
        response: Promise.resolve(Result.ok({
          content: '',
          toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } }],
        })),
      }),
    };

    const toolRegistryWithTool = {
      describeAll: () => [
        { name: 'readFile', description: 'Read a file', parameters: { type: 'object' } },
      ],
      filter: () => [],
      get: () => null,
      register: () => Effect.succeed(undefined),
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('file content'),
      executeBatch: (toolCalls: any[]) =>
        Effect.succeed(
          toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: 'file content' })),
        ),
    };

    const maxSteps = 1;

    const gen = runReActLoop(
      [{ role: 'user', content: 'read file' }],
      maxSteps,
      mockLlm as any,
      mockExecutor as any,
      toolRegistryWithTool as any,
      'test-session',
      1,
      '/tmp',
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });
});
