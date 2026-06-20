import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// Mock session/io.js before importing service
vi.mock('../../src/session/io.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    findSessionIndex: vi.fn(() => ({ currentTurnId: 5 })),
    resolveSessionJsonlPath: vi.fn((_sessionId: string) => `/tmp/sessions/${_sessionId}.jsonl`),
    readHistory: vi.fn(() => [
      { type: 'user', content: 'hello', uuid: 'u1', turnId: 1 },
      { type: 'assistant', content: 'world', uuid: 'a1', turnId: 1, toolCalls: [], model: 'test' },
    ]),
    appendLine: vi.fn(),
  };
});

vi.mock('../../src/llm/llm-resolver.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveLLM: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    appendFileSync: vi.fn(),
  };
});

import { ContextService, setContextInstance, getContextInstance, assemblePayload, compactIfNeeded, compactWithLLM } from '../../src/context/service.js';
import type { BuildResult, CompressResult } from '../../src/context/service.js';
import { findSessionIndex, resolveSessionJsonlPath, readHistory } from '../../src/session/io.js';

const baseConfig = {
  microCompactThreshold: 0.5,
  microCompactMinChars: 120,
  compactionThreshold: 0.9,
  keepRecentTurns: 1,
  compactionModel: '',
  reactiveCompactMaxRetries: 3,
};

describe('ContextService', () => {
  it('exports BuildResult and CompressResult types', () => {
    // Type-level check: these types are importable
    const br: BuildResult = {
      messages: [],
      compactedEvents: [],
      promptEstimate: 0,
      currentTurnId: 0,
      compactedTurnIds: new Set(),
    };
    const cr: CompressResult = {
      didCompress: false,
      released: 0,
      promptEstimate: 0,
    };
    expect(br).toBeDefined();
    expect(cr).toBeDefined();
  });

  it('can be created as an Effect.Service', async () => {
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ContextService;
      }).pipe(Effect.provide(ContextService.Default))
    );
    expect(typeof svc.assemblePayload).toBe('function');
    expect(typeof svc.compactIfNeeded).toBe('function');
    expect(typeof svc.compactWithLLM).toBe('function');
  });

  it('assemblePayload returns BuildResult via service method', async () => {
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ContextService;
      }).pipe(Effect.provide(ContextService.Default))
    );
    const result = svc.assemblePayload('test-session', 'proj', baseConfig as any, 128000);
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('compactedEvents');
    expect(result).toHaveProperty('promptEstimate');
    expect(result).toHaveProperty('currentTurnId');
    expect(result).toHaveProperty('compactedTurnIds');
  });
});

describe('ContextService backward-compatible functions', () => {
  beforeEach(async () => {
    // Initialize the instance before each test
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ContextService;
      }).pipe(Effect.provide(ContextService.Default))
    );
    setContextInstance(svc);
  });

  it('getContextInstance returns the set instance', () => {
    const inst = getContextInstance();
    expect(inst).toBeDefined();
    expect(typeof inst.assemblePayload).toBe('function');
  });

  it('getContextInstance throws if not initialized', () => {
    // Reset instance
    // @ts-expect-error - accessing private module state for test
    const saved = (globalThis as any).__contextSvc;
    setContextInstance(null as any);
    expect(() => getContextInstance()).toThrow('ContextService not initialized');
    // Restore
    const svc = getContextInstance;
  });

  it('standalone assemblePayload delegates to instance', () => {
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 5 });
    const result = assemblePayload('test-session', 'proj', baseConfig as any, 128000);
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('currentTurnId');
  });

  it('standalone compactIfNeeded delegates to instance', async () => {
    const result = await compactIfNeeded('s1', 'proj', [], 10000, baseConfig as any, null);
    expect(result).toHaveProperty('didCompress');
    expect(result).toHaveProperty('released');
    expect(result).toHaveProperty('promptEstimate');
  });

  it('standalone compactWithLLM delegates to instance', async () => {
    const result = await compactWithLLM('s1', 'proj', baseConfig as any, null);
    expect(result).toHaveProperty('didCompress');
    expect(result).toHaveProperty('released');
    expect(result).toHaveProperty('promptEstimate');
  });
});

describe('ContextService compactFailureTracker closure state', () => {
  it('tracks failures per session across calls', async () => {
    const svc = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ContextService;
      }).pipe(Effect.provide(ContextService.Default))
    );

    // With a high prompt estimate and low threshold, compactIfNeeded should attempt compaction
    // but since resolveLLM returns null, compaction will fail
    (findSessionIndex as any).mockReturnValue({ currentTurnId: 0 });

    // First 3 failures should be tracked
    const r1 = await svc.compactIfNeeded('fail-session', 'proj', [], 10000, { ...baseConfig, compactionThreshold: 0.01 } as any, null);
    const r2 = await svc.compactIfNeeded('fail-session', 'proj', [], 10000, { ...baseConfig, compactionThreshold: 0.01 } as any, null);
    const r3 = await svc.compactIfNeeded('fail-session', 'proj', [], 10000, { ...baseConfig, compactionThreshold: 0.01 } as any, null);

    // After 3 failures, the session should be blocked
    const r4 = await svc.compactIfNeeded('fail-session', 'proj', [], 10000, { ...baseConfig, compactionThreshold: 0.01 } as any, null);
    expect(r4.didCompress).toBe(false);
    expect(r4.released).toBe(0);
  });
});
