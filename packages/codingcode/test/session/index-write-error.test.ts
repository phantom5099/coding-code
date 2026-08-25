import { describe, it, expect, vi } from 'vitest';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { computePaths } from '../../src/core/path.js';
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
    const sessionId = 'idx-err-user';
    const cwd = '/tmp';
    const paths = computePaths(cwd, sessionId);
    mkdirSync(dirname(paths.transcriptPath), { recursive: true });
    appendFileSync(paths.transcriptPath, '', 'utf8');
    const state: any = {
      sessionId,
      cwd,
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: {
        type: 'session_meta',
        sessionId,
        cwd,
        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
      },
      model: 'test',
      activeProfile: 'build',
      permissionMode: 'default',
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
    const sessionId = 'idx-err-asst';
    const cwd = '/tmp';
    const paths = computePaths(cwd, sessionId);
    mkdirSync(dirname(paths.transcriptPath), { recursive: true });
    appendFileSync(paths.transcriptPath, '', 'utf8');
    const state: any = {
      sessionId,
      cwd,
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: {
        type: 'session_meta',
        sessionId,
        cwd,
        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
      },
      model: 'test',
      activeProfile: 'build',
      permissionMode: 'default',
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
