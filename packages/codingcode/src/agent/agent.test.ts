import { describe, it, expect } from 'vitest';
import { runReActLoop } from './agent.js';
import { Result } from '../core/result.js';

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
          Result.ok({ content: 'Hello world', finishReason: 'stop' as const }),
        ),
      }),
    };

    const mockExecutor = {
      execute: async () => Result.ok('done'),
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 25,
      availableTools: undefined,
    };

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

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.map((e) => e.text)).toEqual(['Hello', ' ', 'world']);
  });

  it('should handle empty LLM stream gracefully', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          // no chunks
        })(),
        response: Promise.resolve(
          Result.ok({ content: '', finishReason: 'stop' as const }),
        ),
      }),
    };

    const mockExecutor = {
      execute: async () => Result.ok('done'),
      getRegistry: () => ({ describeAll: () => [], filter: () => [] }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 25,
      availableTools: undefined,
    };

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

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(0);
  });

  it('should forward tool-call markers from LLM stream', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: readFile]\n';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } }],
            finishReason: 'tool_calls' as const,
          }),
        ),
      }),
    };

    const mockExecutor = {
      execute: async () => Result.ok('file content'),
      getRegistry: () => ({
        describeAll: () => [
          { name: 'readFile', description: 'Read a file', schema: { type: 'object' } },
        ],
        filter: () => [
          { name: 'readFile', description: 'Read a file', schema: { type: 'object' } },
        ],
      }),
    };

    const config = {
      role: 'coder',
      systemPrompt: 'You are a coder',
      maxSteps: 25,
      availableTools: undefined,
    };

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

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.map((e) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });
});
