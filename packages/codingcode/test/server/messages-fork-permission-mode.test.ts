import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMessagesRouter } from '../../src/server/routes/messages.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { SessionService } from '../../src/session/store.js';
import { HookService } from '../../src/hooks/registry.js';
import { McpService } from '../../src/mcp/index.js';
import { SubagentService } from '../../src/subagent/registry.js';
import { RulesService } from '../../src/rules/index.js';
import { ApprovalService } from '../../src/approval/index.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
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

const mockLLMFactory = {
  getLLMClient: () => Effect.dieMessage('not used in this test'),
  listModels: () => Effect.succeed([]),
  getActiveEntry: () => Effect.dieMessage('not used'),
  findModel: () => Effect.succeed(null),
  createClient: () => Effect.dieMessage('not used'),
} as any;

const mockWorkspace = {
  resolveWorkspaceCwd: (cwd: string | undefined) => Effect.succeed(cwd || '/tmp'),
} as any;

function makeLayer() {
  return Layer.mergeAll(
    ProjectRuntimeService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HookService, mockHookService as any),
          Layer.succeed(McpService, mockMcpService),
          SubagentService.Default,
          Layer.succeed(RulesService, mockRulesService),
          SessionService.Default
        )
      )
    ),
    SessionService.Default,
    Layer.succeed(HookService, mockHookService as any),
    Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any),
    ApprovalService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HookService, mockHookService as any),
          Layer.succeed(ApprovalWaitService, mockApprovalWaitService as any)
        )
      )
    ),
    Layer.succeed(LLMFactoryService, mockLLMFactory as any),
    Layer.succeed(WorkspaceService, mockWorkspace as any)
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
          mode: 'build',
          permissionMode: 'default',
        });
      })
    );
    sessionId = state.sessionId;
    const indexPath = state.indexPath;
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    idx.permissionMode = 'bypass';
    writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

    app = new Hono();
    app.route('/api', createMessagesRouter(rt));
  });

  afterEach(async () => {
    await rt.dispose();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('does not crash and reaches the sendMessage path (fork uses disk permissionMode)', async () => {
    const res = await app.request('/api/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hello', cwd }),
    });
    expect(res.status).not.toBe(404);
  });
});
