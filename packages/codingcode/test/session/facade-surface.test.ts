import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';

describe('session service surface', () => {
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
      'forkSession',
      'listSessions',
      'load',
      'readEvents',
      'readHistory',
      'readUITurns',
      'recordAssistant',
      'recordSystem',
      'recordToolResult',
      'recordUser',
      'renameSession',
      'rollbackToTurn',
      'setActiveProfile',
      'setPermissionMode',
    ]);
  });

  it('does not leak file-level operations through the service', async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SessionService;
      }).pipe(Effect.provide(SessionLayer))
    );
    for (const leaked of [
      'readCurrentIndex',
      'appendLine',
      'writeIndexAtomic',
      'ensureDirs',
      'truncateTitle',
      'countNonMetaEvents',
      'findFirstUserContent',
      'readActiveProfileSync',
      'readTranscript',
      'readUIHistory',
      'filterForUI',
      'sessionEventsToTurns',
      'forkSessionImpl',
    ]) {
      expect(
        (service as unknown as Record<string, unknown>)[leaked],
        `service must not expose ${leaked}`
      ).toBeUndefined();
    }
  });
});
