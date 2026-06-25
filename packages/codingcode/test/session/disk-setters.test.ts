import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

const mockHookService = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
  attachSessionHooks: () => Effect.succeed(undefined),
  disableHook: () => Effect.succeed(undefined),
  enableHook: () => Effect.succeed(undefined),
  disposeSession: () => Effect.succeed(undefined),
  disposeProject: () => Effect.succeed(undefined),
};

const mockMcpService = {
  syncConnections: () => Effect.succeed(undefined),
  connectServers: () => Effect.succeed(undefined),
  listProjectMcpTools: () => [],
  disposeSession: () => Effect.succeed(undefined),
} as any;

const mockRulesService = {
  getAllRules: () => '',
  evictProjectRules: () => undefined,
} as any;

function makeLayer() {
  return SessionService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HookService, mockHookService as any),
        Layer.succeed(McpService, mockMcpService),
        SubagentService.Default,
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
        return yield* session.create(cwd, {
          model: 'm',
          mode: 'build',
          permissionMode: 'default',
        });
      })
    );
    sessionId = state.sessionId;
  });

  afterEach(async () => {
    await rt.dispose();
  });

  it('setModeOnDisk + getModeFromDisk are consistent', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setModeOnDisk(cwd, sessionId, 'plan');
      })
    );
    const mode = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.getModeFromDisk(cwd, sessionId);
      })
    );
    expect(mode).toBe('plan');
  });

  it('setPermissionModeOnDisk + getPermissionModeFromDisk are consistent', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setPermissionModeOnDisk(cwd, sessionId, 'bypass');
      })
    );
    const mode = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.getPermissionModeFromDisk(cwd, sessionId);
      })
    );
    expect(mode).toBe('bypass');
  });

  it('setActiveProfile + getActiveProfile are consistent', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setActiveProfile(cwd, sessionId, 'plan');
      })
    );
    const profile = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.getActiveProfile(cwd, sessionId);
      })
    );
    expect(profile).toBe('plan');
  });

  it('setActiveProfile is durable across reload (file exists on disk)', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setActiveProfile(cwd, sessionId, 'explore');
      })
    );
    const state = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load(cwd, sessionId);
      })
    );
    expect(existsSync(state.indexPath)).toBe(true);
    const idx = JSON.parse(readFileSync(state.indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('explore');
  });
});
