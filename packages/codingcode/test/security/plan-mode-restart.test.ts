import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { ApprovalService } from '../../src/approval/index.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { PLAN_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';

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

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  getPending: () => Effect.succeed([]),
  emitApprovalRequest: () => Effect.succeed(undefined),
  registerEmitter: () => Effect.succeed(undefined),
  delegateEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
};

function makeLayer() {
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const McpTestLayer = Layer.succeed(McpService, mockMcpService);
  const SubagentTestLayer = SubagentService.Default;
  const RulesTestLayer = Layer.succeed(RulesService, mockRulesService);
  const SessionTestLayer = SessionService.Default;
  const ProjectRuntimeTestLayer = ProjectRuntimeService.Default.pipe(
    Layer.provide(Layer.mergeAll(HookTestLayer, McpTestLayer, SubagentTestLayer, RulesTestLayer, SessionTestLayer))
  );
  const ApprovalTestLayer = ApprovalService.Default.pipe(
    Layer.provide(Layer.mergeAll(HookTestLayer, Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)))
  );
  const TestLayer = Layer.mergeAll(
    ProjectRuntimeTestLayer,
    SessionTestLayer,
    HookTestLayer,
    ApprovalTestLayer,
    Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any),
  );
  return TestLayer;
}

describe('plan mode security boundary (cross-restart)', () => {
  let cwd: string;
  let sessionId: string;
  let indexPath: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-security-test-'));
    rt = ManagedRuntime.make(makeLayer() as any);
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.create(cwd, 'test-model');
        return { sessionId: state.sessionId, indexPath: state.indexPath };
      })
    );
    sessionId = result.sessionId;
    indexPath = result.indexPath;
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  // Helper: simulate the real sendMessage path — fork approval, set the
  // session's permission mode (from the runtime's in-memory map), then evaluate.
  async function evaluateAsSession(tool: string, input: any): Promise<any> {
    return rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const approval = yield* ApprovalService;
        const mode = runtime.getSessionPermissionMode(sessionId);
        const forked = yield* approval.fork({});
        yield* forked.setPermissionMode(mode);
        return yield* forked.evaluate({ tool, input, sessionId });
      })
    );
  }

  it('scenario 1: switch to plan, write_file is denied by plan-mode rule', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    const decision = await evaluateAsSession('write_file', { path: '/tmp/x', content: 'foo' });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
  });

  it('scenario 2: switch to plan, execute_command is denied', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    const decision = await evaluateAsSession('execute_command', { command: 'echo hello' });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
  });

  it('scenario 3: switch to plan, submit_plan is allowed', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    const decision: any = await evaluateAsSession('submit_plan', { plan_content: 'do things' });
    // After v13: Layer 3 returns null for submit_plan (delegated to Layer 4 hook + Layer 5 user confirm).
    // In tests there is no emitter, so Layer 5 returns deny with this reason.
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/no UI available/i);
    expect(decision.source).toBe('system');
  });

  it('scenario 4: after restart (state reloaded from disk), plan mode still enforced', async () => {
    // First: switch to plan and write to disk
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
      })
    );

    // Verify disk state
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.permissionMode).toBe('plan');
    expect(idx.activeProfile).toBe('plan');

    // Simulate restart: build a new runtime, load state, restore profile.
    await rt.dispose();
    rt = ManagedRuntime.make(makeLayer() as any);
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        const session = yield* SessionService;
        yield* runtime.prepareProject(cwd);
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('plan');
        yield* runtime.restoreSessionProfile(cwd, sessionId, state.activeProfile);
        // After restore, the in-memory map reflects plan mode
        expect(runtime.getSessionPermissionMode(sessionId)).toBe('plan');
      })
    );

    const decision = await evaluateAsSession('write_file', { path: '/tmp/x', content: 'foo' });
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan mode/i);
  });

  it('scenario 5: plan mode → switch to build → write_file is no longer denied by plan mode', async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        yield* runtime.setSessionProfile(cwd, sessionId, PLAN_PROFILE);
        yield* runtime.setSessionProfile(cwd, sessionId, BUILD_PROFILE);
      })
    );

    const decision: any = await evaluateAsSession('write_file', { path: '/tmp/x', content: 'foo' });
    // In build mode, the pipeline no longer denies with the "plan mode" reason.
    if (decision.type === 'deny') {
      expect(decision.source).not.toBe('permission-mode');
      expect(decision.reason).not.toMatch(/plan mode/i);
    }
  });
});
