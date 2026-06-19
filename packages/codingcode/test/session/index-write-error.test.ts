import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { AgentError } from '../../src/core/error.js';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  writeFileSync: vi.fn(() => {
    throw new Error('index write failed');
  }),
}));

describe('SessionService — index write error propagation', () => {
  it('recordUser propagates SESSION_IO_ERROR when writeFileSync throws', async () => {
    const state: any = {
      sessionId: 'idx-err-user',
      cwd: '/tmp',
      projectPath: 'test',
      transcriptPath: '/tmp/idx-err-user.jsonl',
      indexPath: '/tmp/idx-err-user.index.json',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: { model: 'test', createdAt: new Date().toISOString() },
      title: 'idx-err',
      usage: undefined,
      memorySnapshot: '',
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordUser(state, 'hello');
      }).pipe(Effect.provide(SessionService.Default))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const msg = String(exit.cause);
      expect(msg).toContain('SESSION_IO_ERROR');
      expect(msg).toContain('index write failed');
    }
  });

  it('recordAssistant propagates SESSION_IO_ERROR when writeFileSync throws', async () => {
    const state: any = {
      sessionId: 'idx-err-asst',
      cwd: '/tmp',
      projectPath: 'test',
      transcriptPath: '/tmp/idx-err-asst.jsonl',
      indexPath: '/tmp/idx-err-asst.index.json',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: { model: 'test', createdAt: new Date().toISOString() },
      title: 'idx-err',
      usage: undefined,
      memorySnapshot: '',
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordAssistant(state, 'hi', []);
      }).pipe(Effect.provide(SessionService.Default))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const msg = String(exit.cause);
      expect(msg).toContain('SESSION_IO_ERROR');
      expect(msg).toContain('index write failed');
    }
  });
});
