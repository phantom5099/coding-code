import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerMessagesRoutes } from '../../src/server/routes/messages.js';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { HookService } from '../../src/hooks/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { AgentService } from '../../src/agent/port.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const mockHookService = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
} as any;

const mockApprovalWaitService = {
  waitForConfirm: () => Effect.dieMessage('not implemented'),
  resolveConfirm: () => Effect.succeed(false),
  emitApprovalRequest: () => Effect.succeed(undefined),
  registerEmitter: () => Effect.succeed(undefined),
  delegateEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
};

// The message-send path now lives in AgentService.runTurn. A real runTurn loads
// the persisted session (which reads permissionMode from the session head)
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
          permissionMode: 'ask',
        });
      })
    );
    sessionId = state.sessionId;
    await rt.runPromise(
      Effect.gen(function* () {
        const session = yield* SessionService;
        yield* session.setPermissionMode(cwd, sessionId, 'bypass');
      })
    );

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
      body: JSON.stringify({ input: 'hello', cwd, model: 'm' }),
    });
    expect(res.status).not.toBe(404);
    expect(loadedPermissionModes[0]).toBe('bypass');
  });
});
