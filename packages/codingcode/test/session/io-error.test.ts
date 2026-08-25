import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { AgentError } from '../../src/core/error.js';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  appendFileSync: vi.fn(() => {
    throw new Error('disk full');
  }),
}));

describe('SessionService — SESSION_IO_ERROR', () => {
  it('recordUser propagates SESSION_IO_ERROR when appendFileSync throws', async () => {
    const state: any = {
      sessionId: 'io-err-sid',
      cwd: '/tmp',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: {
        type: 'session_meta',
        sessionId: 'io-err-sid',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
      },
      model: 'test',
      activeProfile: 'build',
      permissionMode: 'default',

      title: 'io-err-sid'.slice(0, 8),
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
      expect(msg).toContain('disk full');
    }
  });

  it('recordAssistant propagates SESSION_IO_ERROR when appendFileSync throws', async () => {
    const state: any = {
      sessionId: 'io-err-asst',
      cwd: '/tmp',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: {
        type: 'session_meta',
        sessionId: 'io-err-asst',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
      },
      model: 'test',
      activeProfile: 'build',
      permissionMode: 'default',

      title: 'io-err-asst'.slice(0, 8),
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
    }
  });

  it('Effect.try wraps I/O error as SESSION_IO_ERROR in service method', async () => {
    const state: any = {
      sessionId: 'io-err-eff',
      cwd: '/tmp',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: {
        type: 'session_meta',
        sessionId: 'io-err-eff',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
      },
      model: 'test',
      activeProfile: 'build',
      permissionMode: 'default',

      title: 'io-err-eff'.slice(0, 8),
      usage: undefined,
      memorySnapshot: '',
    };

    const program = Effect.gen(function* () {
      const session = yield* SessionService;
      return yield* session.recordUser(state, 'hello');
    }).pipe(Effect.provide(SessionService.Default));

    const exit = await Effect.runPromiseExit(program);

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const msg = String(exit.cause);
      expect(msg).toContain('SESSION_IO_ERROR');
      expect(msg).toContain('disk full');
    }
  });
});
