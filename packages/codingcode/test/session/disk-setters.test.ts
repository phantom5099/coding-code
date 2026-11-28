import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '@codingcode/session';
import { SessionLayer } from '@codingcode/session';
import { HookService } from '@codingcode/hook';
import { McpService } from '@codingcode/mcp';
import { RulesService } from '@codingcode/rules';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

const mockHookService = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
};

const mockMcpService = {
  syncConnections: () => Effect.succeed(undefined),
  listProjectMcpTools: () => [],
  status: () => Effect.succeed([]),
} as any;

const mockRulesService = {
  getAllRules: () => Effect.succeed(''),
  evictProjectRules: () => Effect.void,
} as any;

function makeLayer() {
  return SessionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HookService, mockHookService as any),
        Layer.succeed(McpService, mockMcpService),
        Layer.succeed(RulesService, mockRulesService)
      )
    )
  );
}

describe('SessionService disk setter/getter consistency', () => {
  let cwd: string;
  let sessionId: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;

  beforeEach(async () => {
    cwd = join(base.dir, 'disk-setters');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(makeLayer() as any);
    const state = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create({
          cwd,
          model: 'm',
          permissionMode: 'askBeforeExec',
        });
      })
    );
    sessionId = state.sessionId;
  });

  afterEach(async () => {
    await rt.dispose();
  });

  it('setPermissionMode persists to loaded state', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setPermissionMode({ cwd, sessionId }, 'bypass');
      })
    );
    const state = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load({ cwd, sessionId });
      })
    );
    expect(state.permissionMode).toBe('bypass');
  });

});
