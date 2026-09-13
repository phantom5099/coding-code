import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/core/path.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalService } from '../../src/approval/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import type { ProfileName } from '../../src/core/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';
import { ApprovalLayer } from '../../src/approval/approval.js';

useTempProjectBase();

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

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  emitApprovalRequest: () => Effect.succeed(undefined),
  registerEmitter: () => Effect.succeed(undefined),
  delegateEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
};

function makeLayer() {
  const HookTestLayer = Layer.succeed(HookService, mockHookService as any);
  const ApprovalTestLayer = ApprovalLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        HookTestLayer,
        Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)
      )
    )
  );
  return Layer.mergeAll(
    SessionLayer,
    HookTestLayer,
    ApprovalTestLayer,
    Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)
  );
}

function setProfileEffect(cwd: string, sessionId: string, profile: 'plan' | 'build') {
  return Effect.gen(function* () {
    const session = yield* SessionService;
    yield* session.setActiveProfile(cwd, sessionId, profile);
  });
}

describe('plan profile security boundary (permission-mode, disk-persisted profile)', () => {
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
        const state = yield* session.create(cwd, {
          model: 'test-model',
          activeProfile: 'build',
          permissionMode: 'default',
        });
        return {
          sessionId: state.sessionId,
          indexPath: computePaths(state.cwd, state.sessionId, state.parentSessionId).indexPath,
        };
      })
    );
    sessionId = result.sessionId;
    indexPath = result.indexPath;
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  async function evaluateAsProfile(
    tool: string,
    input: any,
    profile: ProfileName
  ): Promise<any> {
    return rt.runPromise(
      Effect.gen(function* () {
        const approval = yield* ApprovalService;
        return yield* approval.evaluate({
          tool,
          input,
          sessionId,
          projectPath: cwd,
          permissionMode: 'default',
          profile,
        });
      })
    );
  }

  it('plan profile: write_file is denied by permission-mode', async () => {
    const decision = await evaluateAsProfile('write_file', { path: '/tmp/x', content: 'foo' }, 'plan');
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(decision.source).toBe('permission-mode');
  });

  it('plan profile: execute_command is denied by permission-mode', async () => {
    const decision = await evaluateAsProfile('execute_command', { command: 'echo hello' }, 'plan');
    expect(decision.type).toBe('deny');
    expect(decision.reason).toMatch(/plan profile/i);
    expect(decision.source).toBe('permission-mode');
  });

  it('plan profile: submit_plan is allowed by the plan allow-list', async () => {
    const decision: any = await evaluateAsProfile('submit_plan', { plan_content: 'do things' }, 'plan');
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
  });

  it('after restart (state reloaded from disk), plan profile persists', async () => {
    await rt.runPromise(setProfileEffect(cwd, sessionId, 'plan'));

    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(idx.activeProfile).toBe('plan');

    await rt.dispose();
    rt = ManagedRuntime.make(makeLayer() as any);
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const state = yield* session.load(cwd, sessionId);
        expect(state.activeProfile).toBe('plan');
      })
    );
  });

  it('build profile: write_file is not denied by plan permission-mode', async () => {
    const decision: any = await evaluateAsProfile('write_file', { path: '/tmp/x', content: 'foo' }, 'build');
    if (decision.type === 'deny') {
      expect(decision.source).not.toBe('permission-mode');
      expect(decision.reason).not.toMatch(/plan profile/i);
    }
  });
});
