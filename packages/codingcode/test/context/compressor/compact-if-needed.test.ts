import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../../src/context/service.js';
import { SessionService } from '../../../src/session/store.js';
import { LLMFactoryService } from '../../../src/llm/factory.js';

const { mockLLM } = vi.hoisted(() => ({
  mockLLM: {
    complete: vi.fn(() => Effect.succeed({ content: '<summary>compacted</summary>' })),
    completeStream: () => ({
      stream: (async function* () {})(),
      response: Promise.resolve({
        ok: true as const,
        value: { content: '<summary>compacted</summary>' },
      }),
    }),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 100000,
      supportsToolCalling: false,
      supportsStreaming: true,
    },
  },
}));

vi.mock('../../../src/session/file-ops.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    readHistory: vi.fn(() => [
      { type: 'user', content: 'a'.repeat(200), turnId: 1 },
      { type: 'assistant', content: 'b'.repeat(200), turnId: 1 },
    ]),
  };
});

vi.mock('../../../src/llm/llm-resolver.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveLLM: vi.fn(() => Effect.succeed(mockLLM)),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
    existsSync: vi.fn((p: string) => {
      if (p.endsWith('.index.json')) return true;
      return (actual as any).existsSync(p);
    }),
    readFileSync: vi.fn((p: string, encoding: BufferEncoding) => {
      if (p.endsWith('.index.json')) return JSON.stringify({ currentTurnId: p.includes('ttl-session') ? 0 : 10 });
      return (actual as any).readFileSync(p, encoding);
    }),
  };
});

vi.mock('../../../src/core/util.js', () => ({
  estimateTokens: vi.fn(),
  estimateMessageTokens: vi.fn(),
  estimateTokensForContent: vi.fn(),
}));

import { estimateTokens, estimateMessageTokens } from '../../../src/core/util.js';

const TestLayer = Layer.merge(
  SessionService.Default,
  Layer.succeed(LLMFactoryService, {
    listModels: () => Effect.succeed([]),
    findModel: () => Effect.succeed(null),
    getActiveEntry: () => Effect.fail(new Error('no active model')),
    switchModel: () => Effect.fail(new Error('no models')),
    createClient: () => Effect.fail(new Error('no client')),
    getLLMClient: () => Effect.fail(new Error('no client')),
  } as any)
);

async function getCtxService(): Promise<ContextService> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextService.Default), Effect.provide(TestLayer))
  );
}

function config(threshold: number, maxTokens = 10000) {
  return {
    compactionModel: '',
  } as any;
}

describe('compactIfNeeded', () => {
  beforeEach(() => {
    (estimateTokens as any).mockReturnValue(0);
    (estimateMessageTokens as any).mockReturnValue(50);
  });

  it('returns didCompress=false when promptEstimate is below threshold', async () => {
    (estimateTokens as any).mockReturnValue(100);
    const ctx = await getCtxService();
    const result = await ctx.compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
    expect(result.promptEstimate).toBe(100);
  });

  it('returns didCompress=false when promptEstimate equals threshold', async () => {
    (estimateTokens as any).mockReturnValue(5000);
    const ctx = await getCtxService();
    const result = await ctx.compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect(result.didCompress).toBe(false);
    expect(result.released).toBe(0);
  });

  it('returns didCompress=true when promptEstimate exceeds threshold', async () => {
    (estimateTokens as any).mockReturnValue(10000);
    (estimateMessageTokens as any).mockReturnValue(50);
    const ctx = await getCtxService();
    const result = await ctx.compactIfNeeded(
      's1',
      'proj',
      [
        { type: 'user', content: 'a'.repeat(200), turnId: 1 },
        { type: 'assistant', content: 'b'.repeat(200), turnId: 1 },
        {
          type: 'tool_result',
          output: 'c'.repeat(5000),
          turnId: 1,
          toolName: 'read_file',
          toolCallId: 'tc1',
        },
      ] as any,
      10000,
      config(0.5),
      null
    );
    expect(result.didCompress).toBe(true);
    expect(result.released).toBeGreaterThan(0);
    expect(result.promptEstimate).toBeGreaterThanOrEqual(0);
  });

  it('does not return restoredFiles field (removed)', async () => {
    (estimateTokens as any).mockReturnValue(10000);
    const ctx = await getCtxService();
    const result = await ctx.compactIfNeeded('s1', 'proj', [], 10000, config(0.5), null);
    expect('restoredFiles' in result).toBe(false);
  });

  it('resets failure count after TTL expires', async () => {
    (estimateTokens as any).mockReturnValue(10000);
    const ctx = await getCtxService();
    await ctx.compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    await ctx.compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    await ctx.compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);

    const blocked = await ctx.compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    expect(blocked.didCompress).toBe(false);

    const originalNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 25 * 60 * 60 * 1000);

    const afterTTL = await ctx.compactIfNeeded('ttl-session', 'proj', [], 10000, config(0.5), null);
    expect(afterTTL.didCompress).toBe(false);

    vi.restoreAllMocks();
  });
});
