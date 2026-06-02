import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
import { HookService } from '../../src/hooks/registry.js';

const mockToolRegistry = {
  describeAll: () => [],
  filter: () => [],
  get: () => null,
  register: () => Effect.succeed(undefined),
  allCore: () => [],
  allDeferred: () => [],
  getDef: () => undefined,
};

const mockToolSearch = {
  isLoaded: () => false,
  listLoaded: () => [],
  listUnloadedDeferred: () => [],
  search: () => [],
  reset: () => {},
};

const mockAgentService = {
  runStream: () => { throw new Error('not implemented'); },
};

const mockCtx = {
  build: (_sessionId: string) => Effect.sync(() => [{ role: 'user' as const, content: 'hi' }]),
  appendTurnEnd: (_sessionId: string, _llm?: any, _config?: any) => Effect.succeed({ didCompress: false, released: 0 }),
  compress: (_sessionId: string, _llm?: any, _config?: any) => Effect.succeed({ didCompress: true, released: 1000 }),
};

const mockSession = {
  recordAssistant: (_state: any, _content: string, _toolCalls: any, _model: string) =>
    Effect.sync(() => ({ uuid: 'a1' })),
  recordToolResult: (_state: any, _parentUuid: string, _toolName: string, _toolCallId: string, _output: string) =>
    Effect.sync(() => ({})),
};

const mockCheckpoint = {
  snapshotFinal: () => {},
};

const mockState = {
  sessionId: 'test-sid',
  cwd: '/tmp',
  projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  title: 'test',
  usage: undefined,
  promptEstimate: 0,
};

function makeDeps(overrides?: Record<string, any>) {
  return {
    maxSteps: 25,
    maxStopContinuations: 2,
    executor: null as any,
    toolRegistry: mockToolRegistry as any,
    toolSearch: mockToolSearch as any,
    agentService: mockAgentService as any,
    ctx: mockCtx as any,
    session: mockSession as any,
    checkpoint: mockCheckpoint as any,
    hooks: {
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      reloadUserHooks: () => Effect.succeed(undefined),
    } as unknown as HookService,
    ...overrides,
  };
}

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

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any },
      makeDeps(),
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

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any },
      makeDeps(),
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents).toHaveLength(0);
  });

  it('should feed bash tool results back to LLM', async () => {
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
      ...mockToolRegistry,
      describeAll: () => [
        { name: 'execute_command', description: 'Run shell command', parameters: { type: 'object' } },
      ],
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('On branch main\nnothing to commit'),
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: 'On branch main\nnothing to commit' })),
        ),
    };

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any },
      makeDeps({ maxSteps: 1, toolRegistry: toolRegistryWithBash as any, executor: mockExecutor as any }),
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
      ...mockToolRegistry,
      describeAll: () => [
        { name: 'readFile', description: 'Read a file', parameters: { type: 'object' } },
      ],
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('file content'),
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: 'file content' })),
        ),
    };

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any },
      makeDeps({ maxSteps: 1, toolRegistry: toolRegistryWithTool as any, executor: mockExecutor as any }),
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });

  it('should pass skillInstruction into the system prompt sent to LLM', async () => {
    let capturedSystem: string | undefined;
    const mockLlm = {
      completeStream: (params: any) => {
        capturedSystem = params.system;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(Result.ok({ content: 'done' })),
        };
      },
    };

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any, skillInstruction: 'Use strict TypeScript' },
      makeDeps(),
    );

    for await (const _ of gen) {}

    expect(capturedSystem).toContain('Use strict TypeScript');
  });

  it('should yield a single maxSteps error and a single turn.end hook when maxSteps is exhausted', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield 'calling tool';
        })(),
        response: Promise.resolve(Result.ok({
          content: '',
          toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'x' } }],
        })),
      }),
    };

    const mockExecutor = {
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({
            type: 'ok' as const,
            id: tc.id,
            name: tc.name,
            output: 'file content',
          })),
        ),
    };

    const turnEndCalls: any[] = [];
    const trackingHooks = {
      emit: (eventName: string, payload?: any) => {
        if (eventName === 'agent.turn.end') {
          turnEndCalls.push(payload);
        }
        return Effect.succeed(undefined);
      },
      emitDecision: () => Effect.succeed(null),
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      reloadUserHooks: () => Effect.succeed(undefined),
    };

    const gen = runReActLoop(
      { state: mockState, llm: mockLlm as any },
      makeDeps({
        maxSteps: 1,
        toolRegistry: {
          ...mockToolRegistry,
          describeAll: () => [
            { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
          ],
        } as any,
        executor: mockExecutor as any,
        hooks: trackingHooks as unknown as HookService,
      }),
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const maxStepErrors = events.filter((e: any) => e._tag === 'Error' && e.error?.code === 'MAX_STEPS');
    expect(maxStepErrors).toHaveLength(1);
    expect(turnEndCalls).toHaveLength(1);
    expect(turnEndCalls[0].status).toBe('maxSteps');
  });
});
