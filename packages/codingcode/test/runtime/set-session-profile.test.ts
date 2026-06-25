import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { BUILD_PROFILE, PLAN_PROFILE, EXPLORE_PROFILE } from '../../src/subagent/registry.js';
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

describe('ProjectRuntimeService.setSessionProfile (disk-only)', () => {
  let cwd: string;
  let sessionId: string;
  let indexPath: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;

  beforeEach(async () => {
    cwd = join(base.dir, 'set-session-profile');
    mkdirSync(cwd, { recursive: true });
    rt = ManagedRuntime.make(makeLayer() as any);
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const session = yield* SessionService;
        yield* runtime.prepareProject(cwd);
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

  it('writes mode + permissionMode + activeProfile when switching to plan', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );
    expect(existsSync(indexPath)).toBe(true);
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.mode).toBe('plan');
    expect(idx.permissionMode).toBe('default');
    expect(idx.activeProfile).toBe('plan');
  });

  it('writes mode + permissionMode + activeProfile when switching to build (with override)', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.setSessionProfile(cwd, sessionId, BUILD_PROFILE, 'bypass');
      })
    );
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.mode).toBe('build');
    expect(idx.permissionMode).toBe('bypass');
    expect(idx.activeProfile).toBe('build');
  });

  it('writes activeProfile when switching to explore', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.setSessionProfile(cwd, sessionId, EXPLORE_PROFILE);
      })
    );
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.permissionMode).toBe('bypass');
    expect(idx.activeProfile).toBe('explore');
  });
});
