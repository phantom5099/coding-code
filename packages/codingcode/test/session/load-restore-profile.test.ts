import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, ManagedRuntime } from 'effect';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/core/path.js';
import { readSessionMeta, rewriteSessionMeta } from '../../src/session/file-ops.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

describe('SessionStoreState.activeProfile persistence (disk only)', () => {
  let cwd: string;
  let sessionId: string;
  let transcriptPath: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;

  function loadState() {
    return rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load(cwd, sessionId);
      })
    );
  }

  beforeEach(async () => {
    cwd = join(base.dir, 'load-restore-profile');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(SessionLayer as any);
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.create(cwd, {
          model: 'test-model',
          activeProfile: 'build',
          permissionMode: 'ask',
        });
        return {
          sessionId: state.sessionId,
          transcriptPath: computePaths(state.cwd, state.sessionId, state.parentSessionId)
            .transcriptPath,
        };
      })
    );
    sessionId = result.sessionId;
    transcriptPath = result.transcriptPath;
  });

  afterEach(async () => {
    await rt.dispose();
  });

  it('state.activeProfile is restored for new sessions', async () => {
    const stateBefore = await loadState();
    expect(stateBefore.activeProfile).toBe('build');
  });

  it('state.activeProfile is set when setActiveProfile writes to disk', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setActiveProfile(cwd, sessionId, 'plan');
      })
    );

    const stateAfter = await loadState();
    expect(stateAfter.activeProfile).toBe('plan');
  });

  it('state.activeProfile is set when the session head carries activeProfile', async () => {
    rewriteSessionMeta(transcriptPath, { activeProfile: 'plan', permissionMode: 'ask' });

    const state = await loadState();
    expect(state.activeProfile).toBe('plan');
  });

  it('setActiveProfile writes the profile to disk', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setActiveProfile(cwd, sessionId, 'plan');
      })
    );
    const meta = readSessionMeta(transcriptPath);
    expect(meta?.activeProfile).toBe('plan');
  });
});
