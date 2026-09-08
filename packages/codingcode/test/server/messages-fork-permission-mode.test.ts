import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerMessagesRoutes } from '../../src/server/routes/messages.js';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/core/path.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { AgentService } from '../../src/agent/port.js';
import { WorkspaceService } from '../../src/core/workspace.js';
import { useTempProjectBase } from '../helpers/project-base.js';

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

const mockWorkspace = {
  resolveWorkspaceCwd: (cwd: string | undefined) => cwd || '/tmp',
} as any;

// The message-send path now lives in AgentService.runTurn. A real runTurn loads
// the persisted session (which reads permissionMode from the on-disk index)
// before streaming. We mirror that seam here so the test keeps validating that
// the fork/send path starts from the persisted session state.
const loadedPermissionModes: string[] = [];

const mockAgentService = {
  runTurn: (_input: string, opts: any) =>
    Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.load(opts.cwd, opts.sessionId);
      loadedPermissionModes.push(state.permissionMode);
      return {
        stream: (async function* () {})() as any,
        sessionId: state.sessionId,
      };
    }),
} as any;

function makeLayer() {
  return Layer.mergeAll(
    Layer.succeed(HookService, mockHookService),
    Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any),
    Layer.succeed(WorkspaceService, mockWorkspace),
    Layer.succeed(AgentService, mockAgentService),
    SessionLayer
  );
}

describe('POST /api/sessions/:id/messages — reads permissionMode from disk', () => {
  let cwd: string;
  let sessionId: string;
  let rt: ManagedRuntime.ManagedRuntime<any, any>;
  let app: Hono;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-msg-fork-'));
    rt = ManagedRuntime.make(makeLayer() as any);
    const state = await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.create(cwd, {
          model: 'm',
          activeProfile: 'build',
          permissionMode: 'default',
        });
      })
    );
    sessionId = state.sessionId;
    const indexPath = computePaths(state.cwd, state.sessionId, state.parentSessionId).indexPath;
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    idx.permissionMode = 'bypass';
    writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

    loadedPermissionModes.length = 0;

    app = new Hono();
    registerMessagesRoutes(app, rt);
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('does not crash and the message path loads the persisted session (disk permissionMode)', async () => {
    const res = await app.request('/api/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hello', cwd }),
    });
    expect(res.status).not.toBe(404);
    expect(loadedPermissionModes[0]).toBe('bypass');
  });
});
