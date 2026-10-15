import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { useTempHome } from '../helpers/temp-home.js';
import { projectBaseDir } from '../helpers/project-base.js';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { SubagentRunnerLayer } from '../../src/subagent/subagent.js';
import {
  SubagentRunRegistryLayer,
  SubagentRunRegistryService,
} from '../../src/subagent/registry.js';
import { ApprovalService } from '../../src/approval/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { ContextService } from '../../src/context/port.js';
import { EventSinkLayer } from '../../src/sink/sink.js';
import { MailboxLayer, MailboxService } from '../../src/session/mailbox.js';
import { TurnRegistryLayer } from '../../src/turn/registry.js';
import { TurnRegistryService } from '../../src/turn/port.js';
import { LLMService } from '../../src/llm/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { RulesService } from '../../src/rules/port.js';
import { SkillService } from '../../src/skills/port.js';
import { ToolExecutorLayer } from '../../src/tools/tools.js';
import { TOOLS_BY_NAME } from '../../src/tools/catalog.js';
import { SessionLayer } from '../../src/session/session.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { TodoService } from '../../src/todo/port.js';
import { BUILD_TOOL_NAMES } from '../../src/approval/tool-policy.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath } from '../../src/util/path.js';
import { transcriptPathFor } from '../../src/context/context.js';
import { textPart } from '../../src/llm/types.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';
import type { SessionMetaEvent, SessionRef } from '../../src/session/types.js';
import type { Message, LLMRequest, LLMStreamPart } from '../../src/llm/types.js';

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

// 探针必须进 build profile 的工具白名单，否则 catalog 装配即抛错
const buildNamesMutable = BUILD_TOOL_NAMES as unknown as string[];
buildNamesMutable.push(PROBE);
afterAll(() => {
  const idx = buildNamesMutable.indexOf(PROBE);
  if (idx >= 0) buildNamesMutable.splice(idx, 1);
});

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
  completeStream: (_req: LLMRequest, model: string) =>
    (async function* () {
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
  ToolExecutorLayer.pipe(Layer.provide(HookMock)),
  Layer.succeed(CheckpointService, { snapshotBeforeWrite: () => Effect.void } as any),
  Layer.succeed(ApprovalService, { evaluate: () => Effect.succeed({ type: 'allow' }) } as any),
  Layer.succeed(SkillService, {
    getAll: () => Effect.succeed([]),
    readContent: () => Effect.succeed(''),
  } as any),
  // 历史直接从 transcript 重建，等价于真实 context 的唯一读盘点
  Layer.succeed(ContextService, {
    getHistory: (ref: SessionRef) =>
      Effect.sync(() =>
        readHistory(transcriptPathFor(ref)).flatMap((e) => {
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
    TOOLS_BY_NAME.set(PROBE, probeTool);
  });

  afterEach(() => {
    TOOLS_BY_NAME.delete(PROBE);
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  const spawnOpts = {
    prompt: 'do the thing',
    agentName: 'worker',
    parentSessionId: 'parent-1',
    parentProfile: 'build' as const,
    model: CHILD_MODEL,
    description: 'probes the ctx',
    parentChain: ['parent-1', 'root-1'],
  };

  const childTranscriptPath = (childId: string) =>
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
        const handle = yield* registry.spawn({ ...spawnOpts, parentCwd: cwd });
        const wait = yield* turn.wait(handle.sessionId, 5_000);
        return { handle, wait };
      })
    );

    expect(result.wait).toBe('completed');
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.sessionId).toBe(result.handle.sessionId);
    expect(capturedCtx!.agentName).toBe('worker');
    expect(capturedCtx!.parentChain).toEqual(['parent-1', 'root-1']);

    const meta = readHistory(childTranscriptPath(result.handle.sessionId))[0] as SessionMetaEvent;
    expect(meta.description).toBe('probes the ctx');
    expect(meta.agentName).toBe('worker');
    expect(meta.parentSessionId).toBe('parent-1');
  });

  it('中断运行中的子智能体：wait 返回 failed，父 mailbox 收到续跑引导文案', async () => {
    scripts.set(CHILD_MODEL, ['hang']);

    const result = await run(
      Effect.gen(function* () {
        const registry = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        const mailbox = yield* MailboxService;

        const handle = yield* registry.spawn({ ...spawnOpts, parentCwd: cwd });
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

        const first = yield* registry.spawn({ ...spawnOpts, parentCwd: cwd });
        yield* turn.interrupt(first.sessionId);
        yield* turn.wait(first.sessionId, 5_000);
        yield* mailbox.drain('parent-1');

        const resumed = yield* registry.spawn({
          ...spawnOpts,
          parentCwd: cwd,
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
