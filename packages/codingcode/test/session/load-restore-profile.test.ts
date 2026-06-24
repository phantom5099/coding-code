import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { BUILD_PROFILE } from '../../src/subagent/registry.js';
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
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const McpTestLayer = Layer.succeed(McpService, mockMcpService);
  const SubagentTestLayer = SubagentService.Default;
  const RulesTestLayer = Layer.succeed(RulesService, mockRulesService);
  const SessionTestLayer = SessionService.Default;
  const ProjectRuntimeTestLayer = ProjectRuntimeService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        HookTestLayer,
        McpTestLayer,
        SubagentTestLayer,
        RulesTestLayer,
        SessionTestLayer
      )
    )
  );
  return Layer.mergeAll(ProjectRuntimeTestLayer, SessionTestLayer);
}

describe('SessionStoreState.activeProfile persistence (disk only)', () => {
  let cwd: string;
  let sessionId: string;
  let indexPath: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;

  beforeEach(async () => {
    cwd = join(base.dir, 'load-restore-profile');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(makeLayer() as any);
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.create(cwd, {
          model: 'test-model',
          mode: 'build',
          permissionMode: 'default',
        });
        return { sessionId: state.sessionId, indexPath: state.indexPath };
      })
    );
    sessionId = result.sessionId;
    indexPath = result.indexPath;
  });

  afterEach(async () => {
    await rt.dispose();
  });

  it('state.activeProfile is undefined for new sessions', async () => {
    const stateBefore = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load(cwd, sessionId);
      })
    );
    expect(stateBefore.activeProfile).toBeUndefined();
  });

  it('state.activeProfile is set when setSessionProfile writes to disk', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.setSessionProfile(cwd, sessionId, BUILD_PROFILE);
      })
    );

    const stateAfter = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load(cwd, sessionId);
      })
    );
    expect(stateAfter.activeProfile).toBe('build');
  });

  it('state.activeProfile is set when index file has activeProfile field', async () => {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    idx.activeProfile = 'plan';
    idx.permissionMode = 'default';
    writeFileSync(indexPath, JSON.stringify(idx, null, 2));

    const state = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.load(cwd, sessionId);
      })
    );
    expect(state.activeProfile).toBe('plan');
  });

  it('restoreSessionProfile writes the profile to disk', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.restoreSessionProfile(cwd, sessionId, 'plan');
      })
    );
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('plan');
  });
});
