import { describe, it, expect } from 'vitest';
import { Effect, Either, Layer } from 'effect';
import { SessionService } from '../../../../src/session/port.js';
import { SessionLayer } from '../../../../src/session/session.js';
import { MailboxService } from '../../../../src/session/mailbox.js';
import { HookService } from '../../../../src/hooks/port.js';
import { TurnRegistryService } from '../../../../src/turn/port.js';
import { SubagentRunRegistryService } from '../../../../src/subagent/registry.js';
import { SUBAGENT_MESSAGE_PREFIX } from '../../../../src/session/types.js';
import { resumeAgentTool } from '../../../../src/tools/domains/subagent/resume.js';
import { sendMessageTool } from '../../../../src/tools/domains/subagent/message.js';
import { interruptAgentTool } from '../../../../src/tools/domains/subagent/interrupt.js';
import { listAgentsTool } from '../../../../src/tools/domains/subagent/list.js';
import { listModels } from '../../../../src/infra/models.js';
import type { SessionStoreState } from '../../../../src/session/types.js';
import type { ToolExecCtx } from '../../../../src/tools/types.js';
import { useTempProjectBase } from '../../../helpers/project-base.js';

useTempProjectBase('codingcode-test-lifecycle-tools-');

const PARENT = 'parent-1';
const OTHER_PARENT = 'parent-2';
const CHILD_MODEL = 'child-model';

let seq = 0;
const freshCwd = () => `/tmp/cc-lifecycle-${++seq}`;

function runTool<T>(eff: Effect.Effect<T, any, any>, layer: Layer.Layer<any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(layer)) as any);
}

/** 跑出 Either：Left 携带 AgentError，用 left.code 断言失败原因 */
function attempt<T>(eff: Effect.Effect<T, any, any>, layer: Layer.Layer<any>) {
  return runTool(Effect.either(eff), layer);
}

function codeOf<T>(r: Either.Either<T, { code?: string }>): string {
  return r._tag === 'Left' ? (r.left.code ?? '(no code)') : 'ok';
}

/** 在磁盘上真实建出一个会话（子会话落在 sessions/<parent>/subagents/） */
function createSession(
  cwd: string,
  parentSessionId: string | undefined,
  overrides: { model?: string; agentName?: string; description?: string } = {}
): Promise<SessionStoreState> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(
        cwd,
        {
          model: overrides.model ?? CHILD_MODEL,
          activeProfile: 'build',
          permissionMode: 'askBeforeExec',
        },
        {
          ...(parentSessionId ? { parentSessionId } : {}),
          ...(overrides.agentName ? { agentName: overrides.agentName } : {}),
          ...(overrides.description ? { description: overrides.description } : {}),
        }
      );
    }).pipe(Effect.provide(SessionLayer)) as any
  ) as Promise<SessionStoreState>;
}

function ctx(cwd: string, over: Partial<ToolExecCtx> = {}): ToolExecCtx {
  return {
    sessionId: PARENT,
    parentChain: [],
    projectPath: cwd,
    activeProfile: 'build',
    model: 'parent-model',
    ...over,
  } as ToolExecCtx;
}

const hooksLayer = (deny = false) =>
  Layer.succeed(HookService, {
    emit: () => Effect.void,
    emitDecision: () => Effect.succeed(deny ? { decision: 'deny', reason: 'nope' } : null),
    reloadUserHooks: () => Effect.void,
  } as any);

function registryLayer() {
  const calls: any[] = [];
  const layer = Layer.succeed(SubagentRunRegistryService, {
    spawn: (opts: any) => {
      calls.push(opts);
      return Effect.succeed({
        sessionId: opts.resumeSessionId ?? 'new-child',
        agentName: opts.agentName,
      });
    },
  } as any);
  return { calls, layer };
}

function mailboxLayer() {
  const items: any[] = [];
  const layer = Layer.succeed(MailboxService, {
    offer: (_sessionId: string, item: any) => {
      items.push(item);
      return Effect.void;
    },
    drain: () => Effect.succeed([]),
    dispose: () => Effect.void,
  } as any);
  return { items, layer };
}

interface ChildRecord {
  sessionId: string;
  agentName?: string;
  description?: string;
  state: string;
  turnId: number;
}

/** 行为与真实 TurnRegistry 一致：只有 running 且已 arm 的记录才能被停 */
function turnLayer(children: ChildRecord[]) {
  const interrupted: string[] = [];
  const layer = Layer.succeed(TurnRegistryService, {
    listChildren: () => Effect.succeed(children),
    interrupt: (sessionId: string) => {
      interrupted.push(sessionId);
      const rec = children.find((c) => c.sessionId === sessionId);
      return Effect.succeed(
        rec && rec.state === 'running' ? ('stopped' as const) : ('not-running' as const)
      );
    },
  } as any);
  return { interrupted, layer };
}

// ---------------------------------------------------------------- resume_agent

describe('resume_agent', () => {
  it('unknown / 兄弟 / 根会话 id 一律拒绝（路径布局天然排除）', async () => {
    const cwd = freshCwd();
    const sibling = await createSession(cwd, OTHER_PARENT);
    const root = await createSession(cwd, undefined);
    const { layer } = registryLayer();
    const layers = Layer.merge(hooksLayer(), layer);

    const resume = (sessionId: string) =>
      attempt(resumeAgentTool.execute({ sessionId, prompt: 'go' }, ctx(cwd)), layers).then(codeOf);

    expect(await resume('nope')).toBe('INVALID_INPUT');
    expect(await resume(sibling.sessionId)).toBe('INVALID_INPUT');
    expect(await resume(root.sessionId)).toBe('INVALID_INPUT');
  });

  it('成功续跑：复用同一会话、带上祖先链、模型取会话头落盘值', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT, { agentName: 'reviewer' });
    const { calls, layer } = registryLayer();

    const output = await runTool(
      resumeAgentTool.execute({ sessionId: child.sessionId, prompt: 'keep going' }, ctx(cwd)),
      Layer.merge(hooksLayer(), layer)
    );

    expect(output).toBe(`resumed reviewer (${child.sessionId})`);
    expect(calls).toHaveLength(1);
    expect(calls[0].resumeSessionId).toBe(child.sessionId);
    expect(calls[0].agentName).toBe('reviewer');
    expect(calls[0].model).toBe(CHILD_MODEL);
    expect(calls[0].parentChain).toEqual([PARENT]);
    // 续跑不重述 systemPrompt，也不重发 description
    expect(calls[0].systemPrompt).toBeUndefined();
    expect(calls[0].description).toBeUndefined();
  });

  it('祖先链跨两代仍然完整：深层子智能体续跑时链条前置当前会话', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { calls, layer } = registryLayer();

    await runTool(
      resumeAgentTool.execute(
        { sessionId: child.sessionId, prompt: 'go' },
        ctx(cwd, { sessionId: PARENT, parentChain: ['mid-1', 'root-1'] })
      ),
      Layer.merge(hooksLayer(), layer)
    );

    expect(calls[0].parentChain).toEqual([PARENT, 'mid-1', 'root-1']);
  });

  it('模型参数可覆盖；未登记的名字回落会话头', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { calls, layer } = registryLayer();
    const layers = Layer.merge(hooksLayer(), layer);

    await runTool(
      resumeAgentTool.execute(
        { sessionId: child.sessionId, prompt: 'go', model: 'definitely-not-a-model' },
        ctx(cwd)
      ),
      layers
    );
    expect(calls[0].model).toBe(CHILD_MODEL);

    const known = listModels()
      .map((m) => m.model)
      .find((m) => m !== CHILD_MODEL);
    expect(known).toBeDefined();
    await runTool(
      resumeAgentTool.execute(
        { sessionId: child.sessionId, prompt: 'go', model: known! },
        ctx(cwd)
      ),
      layers
    );
    expect(calls[1].model).toBe(known);
  });

  it('hook deny → 不派发', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { calls, layer } = registryLayer();

    const code = await attempt(
      resumeAgentTool.execute({ sessionId: child.sessionId, prompt: 'go' }, ctx(cwd)),
      Layer.merge(hooksLayer(true), layer)
    ).then(codeOf);

    expect(code).toBe('TOOL_NOT_ALLOWED');
    expect(calls).toHaveLength(0);
  });

  it('缺会话身份 → CONFIG_MISSING', async () => {
    const { layer } = registryLayer();
    const code = await attempt(
      resumeAgentTool.execute({ sessionId: 'x', prompt: 'go' }, { model: 'm' } as any),
      Layer.merge(hooksLayer(), layer)
    ).then(codeOf);
    expect(code).toBe('CONFIG_MISSING');
  });
});

// --------------------------------------------------------------- send_message

describe('send_message', () => {
  const deliver = (cwd: string, args: any, context: ToolExecCtx) => {
    const { items, layer } = mailboxLayer();
    return attempt(sendMessageTool.execute(args, context), layer).then((r) => ({ r, items }));
  };

  it('主智能体发出：归属行为「当前主智能体」格式（链条为空）', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { r, items } = await deliver(
      cwd,
      { sessionId: child.sessionId, message: 'please hurry' },
      ctx(cwd, { parentChain: [] })
    );

    expect(codeOf(r)).toBe('ok');
    const item = items[0]!;
    expect(item.type).toBe('subagent_message');
    expect(item.sessionId).toBe(PARENT);
    const [prefix, from, body] = item.content.split('\n');
    expect(prefix).toBe(SUBAGENT_MESSAGE_PREFIX);
    expect(from).toBe(`以下是来自于当前主智能体（id：${PARENT}）的信息`);
    expect(body).toBe('please hurry');
  });

  it('子智能体发出：归属行为「（agentname）智能体（id：…）」格式', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { r, items } = await deliver(
      cwd,
      { sessionId: child.sessionId, message: 'status?' },
      ctx(cwd, { parentChain: ['root-1'], agentName: 'worker' })
    );

    expect(codeOf(r)).toBe('ok');
    expect(items[0]!.content.split('\n')[1]).toBe(
      `以下是来自于（worker）智能体（id：${PARENT}）的信息`
    );
  });

  it('链条上任意祖先都可投递（祖父 / 根），免文件校验', async () => {
    const cwd = freshCwd();
    const context = ctx(cwd, { sessionId: 'grandchild-1', parentChain: ['mid-1', 'root-1'] });

    for (const target of ['mid-1', 'root-1']) {
      const { r, items } = await deliver(cwd, { sessionId: target, message: 'hi' }, context);
      expect(codeOf(r), target).toBe('ok');
      expect(items[0]!.sessionId).toBe('grandchild-1');
    }
  });

  it('直接子会话：路径存在即投递', async () => {
    const cwd = freshCwd();
    const child = await createSession(cwd, PARENT);
    const { r } = await deliver(cwd, { sessionId: child.sessionId, message: 'hi' }, ctx(cwd));
    expect(codeOf(r)).toBe('ok');
  });

  it('兄弟会话 / 其它父会话的子会话 / 陌生 id 一律拒绝', async () => {
    const cwd = freshCwd();
    const sibling = await createSession(cwd, OTHER_PARENT);
    const stranger = await createSession(cwd, 'parent-9');

    for (const target of [sibling.sessionId, stranger.sessionId, 'nobody']) {
      const { r, items } = await deliver(cwd, { sessionId: target, message: 'hi' }, ctx(cwd));
      expect(codeOf(r), target).toBe('INVALID_INPUT');
      expect(items).toHaveLength(0);
    }
  });

  it('缺发送方会话 id → CONFIG_MISSING', async () => {
    const { r } = await deliver(freshCwd(), { sessionId: 'x', message: 'hi' }, {
      model: 'm',
    } as any);
    expect(codeOf(r)).toBe('CONFIG_MISSING');
  });
});

// ------------------------------------------------------------ interrupt_agent

describe('interrupt_agent', () => {
  it('在册 running → interrupted', async () => {
    const { interrupted, layer } = turnLayer([
      { sessionId: 'c1', agentName: 'worker', state: 'running', turnId: 1 },
    ]);
    const out = await runTool(
      interruptAgentTool.execute({ sessionId: 'c1' }, ctx(freshCwd())),
      layer
    );
    expect(out).toBe('interrupted c1');
    expect(interrupted).toEqual(['c1']);
  });

  it('不在册 → 统一 not running 文案，且不调用 interrupt（不读磁盘）', async () => {
    const { interrupted, layer } = turnLayer([]);
    const out = await runTool(
      interruptAgentTool.execute({ sessionId: 'gone' }, ctx(freshCwd())),
      layer
    );
    expect(out).toBe('gone is not running');
    expect(interrupted).toEqual([]);
  });

  it('记录在册但已终态 → not running 文案', async () => {
    const { layer } = turnLayer([
      { sessionId: 'c1', agentName: 'worker', state: 'complete', turnId: 1 },
    ]);
    const out = await runTool(
      interruptAgentTool.execute({ sessionId: 'c1' }, ctx(freshCwd())),
      layer
    );
    expect(out).toBe('c1 is not running');
  });

  it('缺会话身份 → CONFIG_MISSING', async () => {
    const { layer } = turnLayer([]);
    const code = await attempt(
      interruptAgentTool.execute({ sessionId: 'x' }, { model: 'm' } as any),
      layer
    ).then(codeOf);
    expect(code).toBe('CONFIG_MISSING');
  });
});

// ---------------------------------------------------------------- list_agents

describe('list_agents', () => {
  it('无子智能体 → 明确提示', async () => {
    const { layer } = turnLayer([]);
    const out = await runTool(listAgentsTool.execute({}, ctx(freshCwd())), layer);
    expect(out).toBe('no subagents for this session');
  });

  it('每行含名称、sessionId、状态、回合与用途描述', async () => {
    const { layer } = turnLayer([
      {
        sessionId: 'c1',
        agentName: 'worker',
        description: 'writes docs',
        state: 'running',
        turnId: 3,
      },
      { sessionId: 'c2', agentName: 'scout', state: 'complete', turnId: 1 },
    ]);
    const out = (await runTool(listAgentsTool.execute({}, ctx(freshCwd())), layer)) as string;
    const lines = out.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('- worker (c1) — running, turn 3: writes docs');
    expect(lines[1]).toBe('- scout (c2) — complete, turn 1: (no description)');
  });

  it('缺会话身份 → CONFIG_MISSING', async () => {
    const { layer } = turnLayer([]);
    const code = await attempt(listAgentsTool.execute({}, { model: 'm' } as any), layer).then(
      codeOf
    );
    expect(code).toBe('CONFIG_MISSING');
  });
});
