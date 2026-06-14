import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { TodoService } from '../../src/agent/todo.js';
import { ContextService } from '../../src/context/service.js';
import { MemoryService } from '../../src/memory/index.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: {
      microCompactThreshold: 0.7,
      microCompactMinChars: 200,
      compactionThreshold: 0.8,
      keepRecentTurns: 10,
      compactionModel: '',
      reactiveCompactMaxRetries: 1,
    },
    memory: {
      enabled: false,
      model: '',
      projectFile: '',
      userFile: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
      extraTypes: [],
      disabledTypes: [],
    },
    server: { port: 8080 },
  }),
}));

import { Result } from '../../src/core/result.js';

import { agentLoop } from '../../src/agent/agent.js';
import { SessionService } from '../../src/session/store.js';

/** Create a MemoryService mock layer with a controllable loadMemoryForPrompt. */
function makeMemoryLayer(loadMemoryForPromptFn: (cwd: string) => string) {
  return Layer.succeed(MemoryService, {
    getMemoryEnabled: () => false,
    setMemoryEnabled: () => {},
    loadMemoryForPrompt: loadMemoryForPromptFn,
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  } as any);
}

const BaseMockLayer = Layer.mergeAll(
  Layer.succeed(CheckpointService, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
  } as any),
  Layer.succeed(SessionService, {
    recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
    recordUser: () => Effect.succeed({ uuid: 'u1' }),
    recordToolResult: () => Effect.succeed({}),
  } as any),
  Layer.succeed(ProjectRuntimeService, {
    prepareProject: () => Effect.void,
    resolveMainAgentProfile: () => undefined,
    resolveSubagentProfile: () => undefined,
    listAgentProfiles: () => [],
    getToolPolicy: () => ({
      allowedTools: undefined,
      allowedMcpServers: undefined,
      allowToolSearch: true,
      allowDeferredTools: false,
    }),
    setSessionProfile: () => {},
    getSessionProfile: () => undefined,
    disposeSession: () => Effect.void,
    disposeProject: () => Effect.void,
  } as any),
  Layer.succeed(TodoService, {
    read: () => [],
    write: () => {},
    reset: () => {},
  } as any),
  Layer.succeed(ContextService, {
    assemblePayload: () => ({
      messages: [{ role: 'user' as const, content: 'hi' }],
      compactedEvents: [],
      promptEstimate: 10,
      currentTurnId: 1,
      compactedTurnIds: new Set<number>(),
    }),
    compactIfNeeded: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 }),
    compactWithLLM: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 }),
  } as any)
);

const mockHooks = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
} as any;

function makeState(memorySnapshot: string = '') {
  return {
    sessionId: 'memory-test-sid',
    cwd: '/tmp/memory-test',
    projectPath: 'memory-test',
    transcriptPath: '/tmp/memory-test.jsonl',
    indexPath: '/tmp/memory-test.index.json',
    messageCount: 0,
    currentTurnId: 1,
    sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
    title: 'memory-test',
    usage: undefined,
    promptEstimate: 0,
    memorySnapshot,
  };
}

function makeCapturingLlm() {
  const captured: { system?: string; messages?: any[] } = {};
  const llm = {
    completeStream: (params: any) => {
      captured.system = params.system;
      captured.messages = params.messages;
      return {
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      };
    },
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any, memorySnapshot: string = '', diskMemory: string = '') {
  const state = makeState(memorySnapshot);
  const q = Effect.runSync(Queue.unbounded<any>());
  const memoryLayer = makeMemoryLayer(() => diskMemory);
  const fullLayer = Layer.mergeAll(BaseMockLayer, memoryLayer);
  await Effect.runPromise(
    agentLoop(null as any, mockHooks, 1, 0, { state, llm }, q).pipe(
      Effect.provide(fullLayer)
    ) as any
  );
}

describe('Memory snapshot stability', () => {
  it('system prompt uses state.memorySnapshot instead of loadMemoryForPrompt', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(
      llm,
      '## Long-term Memory\n\nOriginal snapshot',
      '## Long-term Memory\n\nNew content from disk'
    );
    expect(captured.system).toContain('Original snapshot');
    expect(captured.system).not.toContain('New content from disk');
  });

  it('system prompt is byte-identical across consecutive turns with same snapshot', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nFrozen', '## Long-term Memory\n\nSame content');
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm, '## Long-term Memory\n\nFrozen', '## Long-term Memory\n\nSame content');
    const second = captured.system;
    expect(second).toBe(first);
  });

  it('injects <system-reminder> when memory changed since snapshot', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(
      llm,
      '## Long-term Memory\n\nOriginal snapshot',
      '## Long-term Memory\n\nUpdated on disk'
    );
    expect(captured.system).toContain('Original snapshot');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).toContain('<system-reminder>');
    expect(lastUserMsg.content).toContain('Updated on disk');
  });

  it('does not inject <system-reminder> when memory matches snapshot', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '## Long-term Memory\n\nSame', '## Long-term Memory\n\nSame');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).not.toContain('<system-reminder>');
  });

  it('does not inject <system-reminder> when both snapshot and current are empty', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm, '', '');
    const lastUserMsg = [...(captured.messages ?? [])]
      .reverse()
      .find((m: any) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg.content).not.toContain('<system-reminder>');
  });
});
