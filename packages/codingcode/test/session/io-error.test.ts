import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { AppLayer } from '../../src/layer.js';
import { SessionService } from '../../src/session/store.js';
import * as fs from 'fs';

// Mock fs at module level so appendFileSync throws
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  appendFileSync: vi.fn(() => { throw new Error('disk full'); }),
}));

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

describe('SessionService — SESSION_IO_ERROR', () => {
  it('recordUser propagates SESSION_IO_ERROR when appendFileSync throws', async () => {
    const program = Effect.gen(function* () {
      const session = yield* SessionService;
      const state: any = {
        sessionId: 'io-err-sid',
        cwd: '/tmp',
        projectPath: 'test',
        transcriptPath: '/tmp/io-err.jsonl',
        indexPath: '/tmp/io-err.index.json',
        messageCount: 0,
        currentTurnId: 1,
        sessionMeta: { model: 'test', version: '0.1.0', createdAt: new Date().toISOString() },
        title: 'io-err-sid'.slice(0, 8),
        tokenCountEstimate: 0,
      };
      return yield* session.recordUser(state, 'hello');
    });

    const err = await runWithLayer(program.pipe(Effect.flip));
    expect((err as any).code).toBe('SESSION_IO_ERROR');
    expect((err as any).message).toContain('disk full');
  });

  it('recordAssistant propagates SESSION_IO_ERROR when appendFileSync throws', async () => {
    const program = Effect.gen(function* () {
      const session = yield* SessionService;
      const state: any = {
        sessionId: 'io-err-asst',
        cwd: '/tmp',
        projectPath: 'test',
        transcriptPath: '/tmp/io-err-asst.jsonl',
        indexPath: '/tmp/io-err-asst.index.json',
        messageCount: 0,
        currentTurnId: 1,
        sessionMeta: { model: 'test', version: '0.1.0', createdAt: new Date().toISOString() },
        title: 'io-err-asst'.slice(0, 8),
        tokenCountEstimate: 0,
      };
      return yield* session.recordAssistant(state, 'hi', [], 'model');
    });

    const err = await runWithLayer(program.pipe(Effect.flip));
    expect((err as any).code).toBe('SESSION_IO_ERROR');
  });
});
