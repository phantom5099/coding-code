import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { useTempHome } from '../helpers/temp-home.js';
import { projectBaseDir } from '../helpers/project-base.js';
import { AgentLayer } from '@codingcode/agent';
import { ToolEnvLayer } from '@codingcode/agent';
import { SubagentRunnerLayer } from '@codingcode/subagent';
import {
  SubagentRunRegistryLayer,
  SubagentRunRegistryService,
} from '@codingcode/subagent';
import { ApprovalService } from '@codingcode/approval';
import { CheckpointService } from '@codingcode/checkpoint';
import { ContextService } from '@codingcode/context';
import { EventSinkLayer } from '@codingcode/sink';
import { MailboxLayer, MailboxService } from '@codingcode/mailbox';
import { TurnRegistryLayer } from '@codingcode/turn';
import { TurnRegistryService } from '@codingcode/turn';
import { LLMService } from '@codingcode/model';
import { MemoryService } from '@codingcode/memory';
import { RulesService } from '@codingcode/rules';
import { SkillService } from '@codingcode/skill';
import { ToolExecutorLayer, makeToolRegistryLayer } from '@codingcode/tool';
import { ALL_BUILTIN_TOOLS } from '../helpers/builtin-tools.js';
import { SessionLayer, transcriptPathOf } from '@codingcode/session';
import { HookService } from '@codingcode/hook';
import { McpService } from '@codingcode/mcp';
import { TodoService } from '@codingcode/todo';
import { readHistory } from '@codingcode/session/file-ops';
import { encodeProjectPath, normalizePath } from '@codingcode/util';
import { textPart } from '@codingcode/model';
import type { ToolDefinition, ToolExecCtx } from '@codingcode/tool';
import type { SessionMetaEvent, SessionRef } from '@codingcode/session';
import type { Message, LLMInvocation, LLMStreamPart } from '@codingcode/model';

const CHILD_MODEL = 'integration-child-model';
const PROBE = '__lifecycle_ctx_probe';

/** 探针工具：把子会话回合里工具真正收到的那份 ctx 抓出来 */
let capturedCtx: ToolExecCtx | undefined;
const probeTool: ToolDefinition = {
  name: PROBE,
  concurrencySafe: true,
  description: 'probe: capture ctx',
  parameters: z.object({}),
  execute: (_args, ctx) => {
    capturedCtx = ctx;
    return Effect.succeed('probed');
  },
};

// ---- LLM 脚本：按模型排队，逐次取一段响应；'hang' 表示永不收尾 ----
type Step = LLMStreamPart[] | 'hang';

const scripts = new Map<string, Step[]>();
const cursors = new Map<string, number>();

const text = (t: string): LLMStreamPart => ({ type: 'text', text: t });
const end = (): LLMStreamPart => ({ type: 'end' });
const toolCall = (id: string, name: string, args: Record<string, unknown> = {}): LLMStreamPart => ({
  type: 'tool_call',
  id,
  name,
  arguments: args,
});

const LLMMock = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({ content: 'n/a' }),
  completeStream: (req: LLMInvocation) =>
    (async function* () {
      const model = req.model;
      const i = cursors.get(model) ?? 0;
      cursors.set(model, i + 1);
      const step = scripts.get(model)?.[i];
      if (step === 'hang') {
        await new Promise((r) => setTimeout(r, 30_000));
        yield end();
        return;
      }
      for (const part of step ?? [text('done'), end()]) yield part;
    })(),
} as any);

const HookMock = Layer.succeed(HookService, {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
} as any);

const Deps = Layer.mergeAll(
  SessionLayer,
  ToolExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(HookMock, makeToolRegistryLayer([...ALL_BUILTIN_TOOLS, probeTool]))
    )
  ),
  Layer.succeed(CheckpointService, { ensureBaseline: () => Effect.void } as any),
  Layer.succeed(ApprovalService, {
    evaluate: () => Effect.succeed({ type: 'allow', source: 'test' }),
    evaluateBatch: (requests: readonly unknown[]) =>
      Effect.succeed(requests.map(() => ({ type: 'allow' as const, source: 'test' }))),
    evaluateEscalation: () => Effect.succeed({ type: 'allow', source: 'test' }),
    evaluateEscalationBatch: (requests: readonly unknown[]) =>
      Effect.succeed(requests.map(() => ({ type: 'allow' as const, source: 'test' }))),
  } as any),
  Layer.succeed(SkillService, {
    getAll: () => Effect.succeed([]),
    readContent: () => Effect.succeed(''),
  } as any),
  // 历史直接从 transcript 重建，等价于真实 context 的唯一读盘点
  Layer.succeed(ContextService, {
    getHistory: ({ session: ref }: { session: SessionRef }) =>
      Effect.sync(() =>
        readHistory(transcriptPathOf(ref)).flatMap((e) => {
          if (e.type === 'user') return [{ role: 'user', content: e.content }] as Message[];
          if (e.type === 'assistant')
            return [
              { role: 'assistant', content: [textPart(e.content)], tool_calls: e.toolCalls },
            ] as Message[];
          if (e.type === 'tool_result')
            return [
              {
                role: 'tool',
                content: [textPart(e.output ?? '')],
                tool_call_id: e.toolCallId,
                tool_name: e.toolName,
              } as Message,
            ];
          return [];
        })
      ),
    absorb: () => Effect.void,
    compact: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
    dispose: () => Effect.void,
  } as any),
  EventSinkLayer,
  TurnRegistryLayer.pipe(Layer.provide(EventSinkLayer)),
  MailboxLayer,
  Layer.succeed(MemoryService, {
    loadMemoryForPrompt: () => Effect.succeed(''),
    flushSessionToMemory: () => Effect.succeed({ written: false, bytes: 0 }),
  } as any),
  LLMMock,
  Layer.succeed(RulesService, {
    getAllRules: () => Effect.succeed(''),
    evictProjectRules: () => Effect.void,
  } as any),
  HookMock,
  Layer.succeed(McpService, {
    syncConnections: () => Effect.void,
    listProjectMcpTools: () => Effect.succeed([]),
  } as any),
  Layer.succeed(TodoService, {
    read: () => [],
    write: () => {},
    dispose: () => Effect.void,
  } as any),
  ToolEnvLayer
);

const AgentWired = AgentLayer.pipe(Layer.provide(Deps as any));
const RunnerWired = SubagentRunnerLayer.pipe(Layer.provide(AgentWired));
const RegistryWired = SubagentRunRegistryLayer.pipe(
  Layer.provide(Layer.mergeAll(Deps as any, RunnerWired))
);
const Runtime = Layer.mergeAll(Deps as any, AgentWired, RunnerWired, RegistryWired);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(Runtime as any)) as any);
}

describe('subagent lifecycle integration (real agent + runner + registry)', () => {
  useTempHome('codingcode-test-lifecycle-home-');

  let cwd: string;

  beforeEach(() => {
    mkdirSync(projectBaseDir(), { recursive: true });
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-test-lifecycle-cwd-'));
    scripts.clear();
    cursors.clear();
    capturedCtx = undefined;
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  const spawnOpts = (projectCwd: string) => ({
    prompt: 'do the thing',
    agentName: 'worker',
    parent: {
      cwd: projectCwd,
      sessionId: 'parent-1',
      parentSessionId: 'root-1',
      parentChain: ['root-1'],
    },
    model: CHILD_MODEL,
    description: 'probes the ctx',
  });

  // 新布局：不论派发多深，子会话转录一律挂在顶层主会话（链末位）的 subagents/ 下
  const childTranscriptPath = (childId: string) =>
    join(
      projectBaseDir(),
      encodeProjectPath(normalizePath(cwd)),
      'sessions',
      'root-1',
      'subagents',
      `${childId}.jsonl`
    );

  // 旧布局（链未落盘前的孙代会话位置）：新代码不应再往这里写
  const legacyChildTranscriptPath = (childId: string) =>
    join(
      projectBaseDir(),
      encodeProjectPath(normalizePath(cwd)),
      'sessions',
      'parent-1',
      'subagents',
      `${childId}.jsonl`
    );

  it('祖先链随 spawn 顺传到子会话回合的工具上下文，description 落进会话头', async () => {
    scripts.set(CHILD_MODEL, [
      [toolCall('tc1', PROBE), end()],
      [text('child answer'), end()],
    ]);

    const result = await run(
      Effect.gen(function* () {
        const registry = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        const handle = yield* registry.spawn(spawnOpts(cwd));
        const wait = yield* turn.wait(handle.sessionId, 5_000);
        return { handle, wait };
      })
    );

    expect(result.wait).toBe('completed');
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.session?.sessionId).toBe(result.handle.sessionId);
    expect(capturedCtx!.agentName).toBe('worker');
    expect(capturedCtx!.session?.parentChain).toEqual(['parent-1', 'root-1']);

    const meta = readHistory(childTranscriptPath(result.handle.sessionId))[0] as SessionMetaEvent;
    expect(meta.description).toBe('probes the ctx');
    expect(meta.agentName).toBe('worker');
    expect(meta.parentSessionId).toBe('parent-1');
    // 链随会话头落盘：续跑与路径定位都不必依赖调用方重述
    expect(meta.parentChain).toEqual(['parent-1', 'root-1']);
    // 统一布局：直接父会话名下不再出现子目录
    expect(existsSync(legacyChildTranscriptPath(result.handle.sessionId))).toBe(false);
  });

  it('中断运行中的子智能体：wait 返回 failed，父 mailbox 收到续跑引导文案', async () => {
    scripts.set(CHILD_MODEL, ['hang']);

    const result = await run(
      Effect.gen(function* () {
        const registry = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        const mailbox = yield* MailboxService;

        const handle = yield* registry.spawn(spawnOpts(cwd));
        const outcome = yield* turn.interrupt(handle.sessionId);
        const wait = yield* turn.wait(handle.sessionId, 5_000);
        const items = yield* mailbox.drain('parent-1');
        return { handle, outcome, wait, items };
      })
    );

    expect(result.outcome).toBe('stopped');
    expect(result.wait).toBe('failed');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.type).toBe('subagent_result');
    expect(result.items[0]!.content).toContain('Message Type: FINAL_ANSWER');
    expect(result.items[0]!.content).toContain('Resume it with resume_agent');
  });

  it('中断后再 resume：同一 sessionId 开新回合且带上首轮历史', async () => {
    scripts.set(CHILD_MODEL, ['hang', [text('second pass'), end()]]);

    const result = await run(
      Effect.gen(function* () {
        const registry = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        const mailbox = yield* MailboxService;

        const first = yield* registry.spawn(spawnOpts(cwd));
        yield* turn.interrupt(first.sessionId);
        yield* turn.wait(first.sessionId, 5_000);
        yield* mailbox.drain('parent-1');

        const resumed = yield* registry.spawn({
          ...spawnOpts(cwd),
          resumeSessionId: first.sessionId,
          description: undefined,
        });
        const wait = yield* turn.wait(resumed.sessionId, 5_000);
        return { first, resumed, wait };
      })
    );

    expect(result.resumed.sessionId).toBe(result.first.sessionId);
    expect(result.wait).toBe('completed');

    // 同一份 transcript：首轮的 user 事件仍在，续跑又追加一条
    const events = readHistory(childTranscriptPath(result.first.sessionId));
    expect(events.filter((e) => e.type === 'user')).toHaveLength(2);
  });
});
