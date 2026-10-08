import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { AgentError } from '../../src/util/error.js';
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
      type: 'session_meta',
      sessionId: 'io-err-sid',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      model: 'test',
      title: 'io-err-s',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
      currentTurnId: 1,
      usage: undefined,
      memorySnapshot: '',
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordUser(state, 'hello');
      }).pipe(Effect.provide(SessionLayer))
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
      type: 'session_meta',
      sessionId: 'io-err-asst',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      model: 'test',
      title: 'io-err-a',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
      currentTurnId: 1,
      usage: undefined,
      memorySnapshot: '',
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.recordAssistant(state, 'hi', []);
      }).pipe(Effect.provide(SessionLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const msg = String(exit.cause);
      expect(msg).toContain('SESSION_IO_ERROR');
    }
  });

  it('Effect.try wraps I/O error as SESSION_IO_ERROR in service method', async () => {
    const state: any = {
      type: 'session_meta',
      sessionId: 'io-err-eff',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      model: 'test',
      title: 'io-err-e',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
      currentTurnId: 1,
      usage: undefined,
      memorySnapshot: '',
    };

    const program = Effect.gen(function* () {
      const session = yield* SessionService;
      return yield* session.recordUser(state, 'hello');
    }).pipe(Effect.provide(SessionLayer));

    const exit = await Effect.runPromiseExit(program);

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const msg = String(exit.cause);
      expect(msg).toContain('SESSION_IO_ERROR');
      expect(msg).toContain('disk full');
    }
  });
});
