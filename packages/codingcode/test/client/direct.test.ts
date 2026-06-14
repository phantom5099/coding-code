import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { createDirectClient, agentEventToStreamChunk } from '../../src/client/direct.js';
import type { LLMClient } from '../../src/llm/client.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { AgentError } from '../../src/core/error.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { LLMFactoryService } from '../../src/llm/factory.js';

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/tmp/test',
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  getLLMClient: () => Effect.succeed(null),
  listModels: () =>
    Effect.succeed([
      {
        id: 'test-model@TEST_KEY',
        provider: 'test',
        driver: 'openai',
        name: 'Test Model',
        model: 'test-model',
        base_url: 'http://localhost',
        api_key_env: 'TEST_KEY',
        context_window: 128000,
      },
    ]),
  switchModel: (id: string) =>
    Effect.fail(new AgentError('CONFIG_INVALID', `Model "${id}" not found. Use /model to list.`)),
  findModel: () => Effect.succeed(null),
  getActiveEntry: () => Effect.fail(new AgentError('CONFIG_INVALID', 'No active model configured')),
  createClient: () => Effect.succeed(null),
} as any);

const TestLayer = Layer.mergeAll(
  ApprovalWaitService.Default,
  MockWorkspaceLayer,
  MockLLMFactoryLayer
);

const rt = ManagedRuntime.make(TestLayer);

const noopLlm: LLMClient = {
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true, value: { content: '', finishReason: 'stop' as const } }),
  }),
  complete: () =>
    Effect.succeed({
      content: '',
      finishReason: 'stop' as const,
      usage: { prompt: 0, completion: 0, total: 0 },
    }),
  modelInfo: {
    model: 'test',
    provider: 'test',
    maxTokens: 128000,
    supportsToolCalling: true,
    supportsStreaming: true,
  },
};

describe('createDirectClient model operations', () => {
  it('lists models from the local model catalog without HTTP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm, rt);

    const result = await client.listModels();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.models.length).toBeGreaterThan(0);
    // activeId is null when no activeModel is set in config
    expect(result.activeId === null || typeof result.activeId === 'string').toBe(true);

    fetchSpy.mockRestore();
  });

  it('rejects unknown model switches without contacting server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm, rt);

    await expect(client.switchModel('missing-model@MISSING_KEY')).rejects.toThrow('not found');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('agentEventToStreamChunk - approval interleaving', () => {
  it('yields approval_request chunks without blocking on subsequent events', async () => {
    async function* source() {
      yield { _tag: 'LlmChunk' as const, text: 'before' };
      yield {
        _tag: 'ApprovalRequest' as const,
        id: 'apr-1',
        tool: 'bash',
        args: { command: 'ls' },
      };
      yield { _tag: 'LlmChunk' as const, text: 'after' };
      yield { _tag: 'Done' as const, content: 'done' };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ type: 'text', text: 'before', messageId: 0 });
    expect(chunks[1]).toEqual({
      type: 'approval_request',
      id: 'apr-1',
      tool: 'bash',
      args: { command: 'ls' },
    });
    expect(chunks[2]).toEqual({ type: 'text', text: 'after', messageId: 0 });
    expect(chunks[3]).toEqual({ type: 'done' });
  });

  it('yields multiple sequential approval_request chunks', async () => {
    async function* source() {
      yield { _tag: 'ApprovalRequest' as const, id: 'apr-1', tool: 'bash', args: {} };
      yield { _tag: 'ApprovalRequest' as const, id: 'apr-2', tool: 'write_file', args: {} };
      yield { _tag: 'Done' as const, content: '' };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({ type: 'approval_request', id: 'apr-1' });
    expect(chunks[1]).toMatchObject({ type: 'approval_request', id: 'apr-2' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('yields usage chunks', async () => {
    async function* source() {
      yield { _tag: 'Step' as const, step: 1, max: 10 };
      yield { _tag: 'Assistant' as const, content: 'ok' };
      yield { _tag: 'Usage' as const, prompt: 1000, completion: 500, total: 1500 };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'message', id: 1, content: 'ok', partial: false },
      { type: 'usage', prompt: 1000, completion: 500, total: 1500 },
    ]);
  });

  it('yields error chunk with code from AgentError', async () => {
    async function* source() {
      yield { _tag: 'Error' as const, error: AgentError.toolExecutionFailed('bash', 'EACCES') };
      yield { _tag: 'Done' as const, content: '' };
    }

    const chunks: any[] = [];
    for await (const chunk of agentEventToStreamChunk(source())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        type: 'error',
        message: expect.stringContaining('bash'),
        code: 'TOOL_EXECUTION_FAILED',
      },
      { type: 'done' },
    ]);
  });
});

describe('approval buffering - race condition fix', () => {
  const run = <T>(eff: Effect.Effect<T, any, any>): Promise<T> => rt.runPromise(eff);

  it('buffers approval request when notify is null', async () => {
    const sessionId = 'buffer-' + Math.random().toString(36).slice(2);
    let notify: ((req: any) => void) | null = null;
    let bufferedApproval: any = null;
    const delivered: any[] = [];

    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.registerEmitter(
          sessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            const req = { type: 'approval_request' as const, id, tool, args };
            if (notify) {
              const cb = notify;
              notify = null;
              cb(req);
            } else {
              bufferedApproval = req;
            }
          }
        );
      })
    );

    try {
      // Simulate the race loop: chunk arrives, notify set to null
      notify = null;

      // Fire approval request while notify is null
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.emitApprovalRequest(sessionId, 'apr-1', 'bash', { command: 'ls' });
        })
      );

      // Should have been buffered
      expect(bufferedApproval).not.toBeNull();
      expect(bufferedApproval.id).toBe('apr-1');
      expect(bufferedApproval.tool).toBe('bash');

      // Consume buffer
      const req = bufferedApproval;
      bufferedApproval = null;
      delivered.push(req);

      // Now set notify and fire another request
      notify = (r) => delivered.push(r);
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.emitApprovalRequest(sessionId, 'apr-2', 'bash', { command: 'pwd' });
        })
      );

      // notify should have been consumed (set to null by callback)
      expect(delivered).toHaveLength(2);
      expect(delivered[0].id).toBe('apr-1');
      expect(delivered[1].id).toBe('apr-2');
      expect(bufferedApproval).toBeNull();
      expect(notify).toBeNull();
    } finally {
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.unregisterEmitter(sessionId);
        })
      );
    }
  });

  it('delivers approval immediately when notify is active (no buffering)', async () => {
    const sessionId = 'direct-' + Math.random().toString(36).slice(2);
    let notify: ((req: any) => void) | null = null;
    let bufferedApproval: any = null;
    const delivered: any[] = [];

    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.registerEmitter(
          sessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            const req = { type: 'approval_request' as const, id, tool, args };
            if (notify) {
              const cb = notify;
              notify = null;
              cb(req);
            } else {
              bufferedApproval = req;
            }
          }
        );
      })
    );

    try {
      notify = (r) => delivered.push(r);

      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.emitApprovalRequest(sessionId, 'apr-1', 'bash', { command: 'ls' });
        })
      );

      expect(delivered).toHaveLength(1);
      expect(delivered[0].id).toBe('apr-1');
      expect(notify).toBeNull(); // callback consumed notify
      expect(bufferedApproval).toBeNull();
    } finally {
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.unregisterEmitter(sessionId);
        })
      );
    }
  });

  it('handles multiple approval requests arriving while notify is null', async () => {
    const sessionId = 'multi-' + Math.random().toString(36).slice(2);
    let notify: ((req: any) => void) | null = null;
    let bufferedApproval: any = null;

    await run(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        yield* svc.registerEmitter(
          sessionId,
          (id: string, tool: string, args: Record<string, unknown>) => {
            const req = { type: 'approval_request' as const, id, tool, args };
            if (notify) {
              const cb = notify;
              notify = null;
              cb(req);
            } else {
              bufferedApproval = req;
            }
          }
        );
      })
    );

    try {
      notify = null;

      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.emitApprovalRequest(sessionId, 'apr-1', 'bash', { command: 'a' });
        })
      );

      expect(bufferedApproval).not.toBeNull();
      expect(bufferedApproval.id).toBe('apr-1');

      // Second request also arrives while notify is still null
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.emitApprovalRequest(sessionId, 'apr-2', 'write_file', { path: 'f.txt' });
        })
      );

      // Second request overwrites the buffer (only one slot)
      expect(bufferedApproval.id).toBe('apr-2');

      // Consume apr-2
      bufferedApproval = null;

      // apr-1 is lost (single buffer) — this is acceptable because
      // in practice, the agent loop blocks on each approval sequentially
    } finally {
      await run(
        Effect.gen(function* () {
          const svc = yield* ApprovalWaitService;
          yield* svc.unregisterEmitter(sessionId);
        })
      );
    }
  });
});
