import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import * as facade from '../../src/session/index.js';
import { SessionService, SessionLayer } from '../../src/session/index.js';

describe('session facade surface', () => {
  it('exposes only intent-level capabilities', () => {
    const exported = Object.keys(facade).sort();
    expect(exported).toEqual([
      'SessionLayer',
      'SessionService',
      'readActiveProfileSync',
      'readTranscript',
    ]);
  });

  it('does not leak file-level operations through the facade', () => {
    const f = facade as unknown as Record<string, unknown>;
    for (const leaked of [
      'readCurrentIndex',
      'appendLine',
      'readHistory',
      'deleteSession',
      'setPermissionMode',
      'getPermissionMode',
      'writeIndexAtomic',
      'ensureDirs',
    ]) {
      expect(f[leaked], `facade must not export ${leaked}`).toBeUndefined();
    }
  });

  it('service shape exposes exactly the contract method set', async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SessionService;
      }).pipe(Effect.provide(SessionLayer))
    );
    const methods = Object.keys(service).sort();
    expect(methods).toEqual([
      'appendEvent',
      'appendSummary',
      'create',
      'deleteSession',
      'findUserMessageForTurn',
      'forkSession',
      'getActiveProfile',
      'getMessageCount',
      'getPermissionMode',
      'getSessionId',
      'getTranscriptPath',
      'incrementTurn',
      'listSessions',
      'load',
      'readEvents',
      'readHistory',
      'readUITurns',
      'recordAssistant',
      'recordToolResult',
      'recordUser',
      'renameSession',
      'rollbackToTurn',
      'setActiveProfile',
      'setPermissionMode',
    ]);
  });
});
