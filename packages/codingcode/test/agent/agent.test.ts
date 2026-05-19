import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';

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
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = { systemPrompt: 'You are a coder', maxSteps: 25, availableTools: undefined };

    const gen = runReActLoop(
      [{ role: 'user', content: 'hi' }],
      config,
      mockLlm as any,
      mockExecutor as any,
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
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = { systemPrompt: 'You are a coder', maxSteps: 25, availableTools: undefined };

    const gen = runReActLoop(
      [{ role: 'user', content: 'hi' }],
      config,
      mockLlm as any,
      mockExecutor as any,
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents).toHaveLength(0);
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

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('file content'),
      getRegistry: () => ({
        describeAll: () => [
          { name: 'readFile', description: 'Read a file', schema: { type: 'object' } },
        ],
        filter: () => [
          { name: 'readFile', description: 'Read a file', schema: { type: 'object' } },
        ],
      }),
    };

    const config = { systemPrompt: 'You are a coder', maxSteps: 1, availableTools: undefined };

    const gen = runReActLoop(
      [{ role: 'user', content: 'read file' }],
      config,
      mockLlm as any,
      mockExecutor as any,
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });
});
