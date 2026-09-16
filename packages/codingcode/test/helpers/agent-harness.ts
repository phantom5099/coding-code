// Agent 循环测试基座：通过公开的 AgentService.runTurn 驱动 agent，
// 替代已删除的 agentLoop 自由函数。agent 依赖均以宽服务 mock 注入。
//
// 自 frame 协议重构后，runTurn 产出 FrameBody（信封由装配器另盖），
// 本文件同时提供从 FrameBody[] 中抽取内容的纯函数，供各测试断言使用。
import { Effect, Layer } from 'effect';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { ToolCatalogLayer } from '../../src/agent/tool-catalog.js';
import { AgentService } from '../../src/agent/port.js';
import { ApprovalService } from '../../src/approval/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { ContextService } from '../../src/context/port.js';
import { HookService } from '../../src/hooks/port.js';
import { LLMFactoryService } from '../../src/llm/port.js';
import { McpService } from '../../src/mcp/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { RulesService } from '../../src/rules/port.js';
import { SessionService } from '../../src/session/port.js';
import { SkillService } from '../../src/skills/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { TodoService } from '../../src/todo/port.js';
import { ToolExecutorService } from '../../src/tools/port.js';
import type { FrameBody, RuntimeEvent, Transition } from '../../src/contracts/frame.js';
import type { TokenUsage } from '../../src/contracts/types.js';
import type { LLMStreamPart } from '../../src/contracts/provider.js';
import type { SessionStoreState } from '../../src/contracts/session.js';

// ---- LLM 部件构造器 ----

export function llmStream(...parts: LLMStreamPart[]): AsyncIterable<LLMStreamPart> {
  return (async function* () {
    for (const p of parts) yield p;
  })();
}

export function pText(text: string): LLMStreamPart {
  return { type: 'text', text };
}

export function pToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {}
): LLMStreamPart {
  return { type: 'tool_call', id, name, args };
}

export function pEnd(usage?: TokenUsage): LLMStreamPart {
  return usage ? { type: 'end', usage } : { type: 'end' };
}

// ---- FrameBody 抽取器 ----

export type EventOf<T extends RuntimeEvent['type']> = Extract<RuntimeEvent, { type: T }>;
export type TransitionOf<T extends Transition['to']> = Extract<Transition, { to: T }>;

function eventOf<T extends RuntimeEvent['type']>(
  events: readonly FrameBody[],
  type: T
): EventOf<T>[] {
  const out: EventOf<T>[] = [];
  for (const b of events) {
    if (b.family === 'event' && b.event.type === type) out.push(b.event as EventOf<T>);
  }
  return out;
}

export function textDeltas(events: readonly FrameBody[]): EventOf<'text_delta'>[] {
  return eventOf(events, 'text_delta');
}

export function texts(events: readonly FrameBody[]): string[] {
  return textDeltas(events).map((e) => e.text);
}

export function toolCalls(events: readonly FrameBody[]): EventOf<'tool_call'>[] {
  return eventOf(events, 'tool_call');
}

export function approvalRequests(events: readonly FrameBody[]): EventOf<'approval_request'>[] {
  return eventOf(events, 'approval_request');
}

export function toolResults(events: readonly FrameBody[]): EventOf<'tool_result'>[] {
  return eventOf(events, 'tool_result');
}

/** 含 todos 的 tool_result（todo_write 回执） */
export function todoResults(events: readonly FrameBody[]): EventOf<'tool_result'>[] {
  return toolResults(events).filter((e) => e.todos !== undefined);
}

export function endOf(events: readonly FrameBody[]): TransitionOf<'end'> | undefined {
  for (const b of events) {
    if (b.family === 'transition' && b.transition.to === 'end') return b.transition;
  }
  return undefined;
}

export function hasEnd(events: readonly FrameBody[]): boolean {
  return endOf(events) !== undefined;
}

export function endReason(events: readonly FrameBody[]): TransitionOf<'end'>['reason'] | undefined {
  return endOf(events)?.reason;
}

export function fatalOf(events: readonly FrameBody[]): { message: string; code: string } | undefined {
  for (const b of events) {
    if (b.family === 'fatal') return b.fatal;
  }
  return undefined;
}

/** 本次流中是否发出了压缩信号（compress 转移） */
export function hasCompress(events: readonly FrameBody[]): boolean {
  return events.some((b) => b.family === 'transition' && b.transition.to === 'compress');
}

// ---- 依赖 mock ----

export interface HarnessMocks {
  llm: {
    completeStream: (params: any, signal?: AbortSignal) => AsyncIterable<LLMStreamPart>;
    modelInfo: { maxTokens: number };
  };
  state?: Partial<SessionStoreState>;
  hooks?: {
    emit: (point: string, payload: any) => Effect.Effect<void>;
    emitDecision: (point: string, payload: any) => Effect.Effect<any>;
  };
  executor?: {
    executeBatch: (calls: any[], sessionId?: string, opts?: any) => Effect.Effect<any[]>;
  };
  todo?: Map<string, Array<{ step: string; status: string }>>;
  memorySnapshot?: string;
  /** 可选：覆盖 ContextService.assemblePayload 的返回（默认一条 user 消息）。 */
  contextAssemble?: () => Promise<Array<{ role: string; content: string }>>;
  /** 可选：覆盖 ContextService.willCompact（默认 false）。 */
  contextWillCompact?: () => Promise<boolean>;
  /** 可选：覆盖 SessionService 的个别方法（默认实现见 makeAgentLayer）。 */
  session?: Partial<{
    load: (cwd: string, sid: string) => any;
    create: (cwd: string, opts: any, extra?: any) => any;
    recordUser: (state: any, content: string) => any;
    recordSystem: (state: any, content: string) => any;
    recordAssistant: (state: any, content: string, toolCalls: any[], usage?: any) => any;
    recordToolResult: (state: any, name: string, id: string, output: string) => any;
    setPermissionMode: (cwd: string, sid: string, mode: any) => any;
    setActiveProfile: (cwd: string, sid: string, profile: any) => any;
  }>;
}

export function makeState(partial: Partial<SessionStoreState> = {}): SessionStoreState {
  return {
    sessionId: 'test-sid',
    cwd: '/tmp',
    messageCount: 0,
    sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
    model: 'test-model',
    title: 'test',
    currentTurnId: 1,
    usage: undefined,
    activeProfile: 'build',
    permissionMode: 'default',
    memorySnapshot: '',
    ...partial,
  } as SessionStoreState;
}

export function makeDefaultMocks(overrides: Partial<HarnessMocks> = {}): HarnessMocks {
  const llm =
    overrides.llm ??
    ({
      completeStream: () => llmStream(),
      modelInfo: { maxTokens: 1000 },
    } as any);
  const todo = overrides.todo ?? new Map<string, Array<{ step: string; status: string }>>();
  const hooks = overrides.hooks ?? {
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
  };
  return {
    llm,
    state: overrides.state,
    hooks,
    executor: overrides.executor,
    todo,
    memorySnapshot: overrides.memorySnapshot ?? '',
    session: overrides.session,
  };
}

export interface RunAgentOptions {
  input?: string;
  sessionId?: string;
  cwd?: string;
  signal?: AbortSignal;
  activeProfile?: 'plan' | 'build';
  permissionMode?: string;
}

export function makeAgentLayer(mocks: HarnessMocks): Layer.Layer<any> {
  const state = makeState(mocks.state);
  const store = mocks.todo ?? new Map<string, Array<{ step: string; status: string }>>();
  const hooks = mocks.hooks ?? {
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
  };
  const executor =
    mocks.executor ??
    ({
      executeBatch: (calls: any[]) =>
        Effect.succeed(
          calls.map((c: any) => ({
            status: 'ok' as const,
            id: c.id,
            name: c.name,
            output: '',
          }))
        ),
    } as any);

  const session: Record<string, any> = {
    load: (_cwd: string, sid: string) => Effect.succeed({ ...state, sessionId: sid }),
    create: (_cwd: string, opts: any) =>
      Effect.succeed({
        ...state,
        sessionId: opts.sessionId ?? 'created-sid',
        activeProfile: opts.activeProfile ?? 'build',
      }),
    recordUser: () => Effect.succeed({ turnId: 1 }),
    recordSystem: () => Effect.succeed({}),
    recordAssistant: () => Effect.succeed({}),
    recordToolResult: () => Effect.succeed({}),
    setPermissionMode: () => Effect.void,
    setActiveProfile: () => Effect.void,
    ...(mocks.session ?? {}),
  };

  const skills = {
    extractSkill: (_cwd: string, query: string) => Effect.succeed([undefined, query]),
  };
  const context = {
    willCompact: async () => (mocks.contextWillCompact ? mocks.contextWillCompact() : false),
    assemblePayload: async () =>
      mocks.contextAssemble ? mocks.contextAssemble() : [{ role: 'user' as const, content: 'hi' }],
  };
  const memory = {
    loadMemoryForPrompt: () => mocks.memorySnapshot ?? '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  };

  // ToolCatalogLayer 依赖 McpService，先固化再合并
  const mcpLayer = Layer.succeed(McpService, {
    syncConnections: () => Effect.void,
    listProjectMcpTools: () => Effect.succeed([]),
  } as any);
  const toolCatalogLayer = ToolCatalogLayer.pipe(Layer.provide(mcpLayer));

  const services = Layer.mergeAll(
    Layer.succeed(SessionService, session as any),
    Layer.succeed(ToolExecutorService, executor as any),
    Layer.succeed(CheckpointService, {
      snapshotBaseline: () => Effect.void,
      snapshotFinal: () => Effect.void,
    } as any),
    Layer.succeed(ApprovalService, {
      evaluate: () => Effect.succeed({ type: 'allow', source: 'test' }),
    } as any),
    Layer.succeed(SkillService, skills as any),
    Layer.succeed(ContextService, context as any),
    Layer.succeed(MemoryService, memory as any),
    Layer.succeed(LLMFactoryService, { getLLMClient: () => Effect.succeed(mocks.llm) } as any),
    Layer.succeed(RulesService, {
      getAllRules: () => '',
      evictProjectRules: () => {},
    } as any),
    // agent 与 todo_write 工具消费同一个 TodoService
    Layer.succeed(TodoService, {
      read: (sid: string) => store.get(sid) ?? [],
      write: (sid: string, items: any[]) => {
        store.set(sid, items);
      },
      reset: () => store.clear(),
    } as any),
    // agent 与 dispatch_agent 工具消费同一个 HookService
    Layer.succeed(HookService, {
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      emit: hooks.emit,
      emitDecision: hooks.emitDecision,
      reloadUserHooks: () => Effect.void,
      disposeSession: () => Effect.void,
    } as any),
    mcpLayer,
    Layer.succeed(SubagentRunnerService, {} as any),
    // ToolEnvPort：把上面的具体服务适配成 agent 所需的工具执行期注入能力（同 layer.ts）
    ToolEnvLayer,
    // ToolCatalogPort：静态内置工具 + profile 工具 + MCP 工具的装配（同 layer.ts）
    toolCatalogLayer,
  );
  return services;
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// 模拟真实 LLM 延迟：每个部件后让出宏任务，避免 producer fiber 在微任务队列中
// 一口气跑完导致队列事件被丢弃。
function paceLlm(llm: any): any {
  const completeStream = llm.completeStream.bind(llm);
  llm.completeStream = (params: any, signal?: AbortSignal) => {
    const raw = completeStream(params, signal) as AsyncIterable<LLMStreamPart>;
    return (async function* () {
      for await (const part of raw) {
        yield part;
        await tick();
      }
    })();
  };
  return llm;
}

export async function runAgentTurn(
  mocks: HarnessMocks,
  opts: RunAgentOptions = {}
): Promise<{ events: FrameBody[]; sessionId: string }> {
  const llm = paceLlm(mocks.llm);
  const services = makeAgentLayer({ ...mocks, llm });
  const appLayer = Layer.mergeAll(services, AgentLayer.pipe(Layer.provide(services))) as any;
  const program = Effect.gen(function* () {
    const agent = yield* AgentService;
    const runOpts: any = { cwd: opts.cwd ?? '/tmp' };
    if (opts.sessionId) runOpts.sessionId = opts.sessionId;
    if (opts.signal) runOpts.signal = opts.signal;
    if (opts.activeProfile) runOpts.activeProfile = opts.activeProfile;
    if (opts.permissionMode) runOpts.permissionMode = opts.permissionMode;
    return yield* agent.runTurn(opts.input ?? 'test', runOpts);
  });
  let runRes: { stream: AsyncGenerator<FrameBody>; sessionId: string };
  try {
    runRes = await Effect.runPromise(Effect.provide(program, appLayer) as any);
  } catch (err) {
    console.error('HARNESS-RUN-ERROR', err);
    throw err;
  }
  const { stream, sessionId } = runRes;
  const events: FrameBody[] = [];
  try {
    for await (const e of stream) events.push(e);
  } catch (err) {
    console.error('HARNESS-STREAM-ERROR', err);
    throw err;
  }
  return { events, sessionId };
}
