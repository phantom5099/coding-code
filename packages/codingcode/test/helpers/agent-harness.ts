// Agent 循环测试基座：通过公开的 AgentService.runTurn 驱动 agent，
// 替代已删除的 agentLoop 自由函数。所有 agent 内部服务均以窄端口 mock 注入。
import { Effect, Layer } from 'effect';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { ToolCatalogLayer } from '../../src/agent/tool-catalog.js';
import { AgentService } from '../../src/agent/port.js';
import {
  ApprovalPort,
  CheckpointPort,
  ContextPort,
  HookPort,
  LlmPort,
  McpPort,
  MemoryPort,
  RulesPort,
  SessionPort,
  SkillPort,
  TodoPort,
  ToolExecutorPort,
} from '../../src/agent/deps.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { TodoService } from '../../src/todo/port.js';
import type { AgentEvent } from '../../src/agent/types.js';
import type { SessionStoreState } from '../../src/session/types.js';

export interface HarnessMocks {
  llm: {
    completeStream: (params: any, signal?: AbortSignal) => {
      stream: AsyncGenerator<string>;
      response: Promise<any>;
    };
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
  /** 可选：覆盖 ContextPort.assemblePayload 的返回（默认不压缩）。 */
  contextAssemble?: () => Promise<{
    messages: Array<{ role: string; content: string }>;
    compressed: boolean;
    released: number;
    promptEstimate: number;
  }>;
  /** 可选：覆盖 SessionPort 窄端口的个别方法（默认实现见 makeAgentLayer）。 */
  sessionPort?: Partial<{
    load: (cwd: string, sid: string) => any;
    create: (cwd: string, opts: any, extra?: any) => any;
    recordUser: (state: any, content: string) => any;
    recordSystem: (state: any, content: string) => any;
    recordAssistant: (state: any, content: string, toolCalls: any[], usage?: any) => any;
    recordToolResult: (state: any, name: string, id: string, output: string) => any;
    getActiveProfile: (cwd: string, sid: string) => any;
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
      completeStream: () => ({
        stream: (async function* () {})(),
        response: Promise.resolve({ ok: true, value: { content: '', toolCalls: [] } }),
      }),
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
    sessionPort: overrides.sessionPort,
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
            type: 'ok' as const,
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
    recordUser: () => Effect.succeed({}),
    recordSystem: () => Effect.succeed({}),
    recordAssistant: () => Effect.succeed({}),
    recordToolResult: () => Effect.succeed({}),
    getActiveProfile: () => Effect.succeed('build'),
    setPermissionMode: () => Effect.void,
    setActiveProfile: () => Effect.void,
    ...(mocks.sessionPort ?? {}),
  };

  const mcpPort = {
    syncConnections: () => Effect.void,
    listProjectMcpTools: () => [],
  };
  const skills = {
    extractSkill: (_cwd: string, query: string) => Effect.succeed([undefined, query]),
    evictProject: () => Effect.void,
  };
  const context = {
    assemblePayload: async () =>
      mocks.contextAssemble
        ? mocks.contextAssemble()
        : {
            messages: [{ role: 'user' as const, content: 'hi' }],
            compressed: false,
            released: 0,
            promptEstimate: 10,
          },
  };
  const memory = {
    loadMemoryForPrompt: () => mocks.memorySnapshot ?? '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  };

  const services = Layer.mergeAll(
    Layer.succeed(SessionPort, session as any),
    Layer.succeed(ToolExecutorPort, executor as any),
    Layer.succeed(CheckpointPort, {
      snapshotBaseline: () => Effect.void,
      snapshotFinal: () => Effect.void,
    } as any),
    Layer.succeed(HookPort, {
      emit: hooks.emit,
      emitDecision: hooks.emitDecision,
      disposeSession: () => Effect.void,
    } as any),
    Layer.succeed(ApprovalPort, {
      evaluate: () => Effect.succeed({ decision: 'allow' }),
      fork: () => Effect.succeed({}),
    } as any),
    Layer.succeed(SkillPort, skills as any),
    Layer.succeed(McpPort, mcpPort as any),
    Layer.succeed(ContextPort, context as any),
    Layer.succeed(MemoryPort, memory as any),
    Layer.succeed(LlmPort, { getLLMClient: () => Effect.succeed(mocks.llm) } as any),
    Layer.succeed(RulesPort, {
      getAllRules: () => '',
      evictProjectRules: () => {},
    } as any),
    Layer.succeed(TodoPort, { read: (sid: string) => store.get(sid) ?? [] } as any),
    // todo_write 工具 execute 执行时 yield* TodoService（完整 tag），窄端口 TodoPort 不可替代
    Layer.succeed(TodoService, {
      read: (sid: string) => store.get(sid) ?? [],
      write: (sid: string, items: any[]) => {
        store.set(sid, items);
      },
      reset: () => store.clear(),
    } as any),
    // dispatch_agent 工具 execute 执行时 yield* 这三个完整服务
    Layer.succeed(HookService, {
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      emit: hooks.emit,
      emitDecision: hooks.emitDecision,
      reloadUserHooks: () => Effect.void,
      disposeSession: () => Effect.void,
    } as any),
    Layer.succeed(McpService, {
      syncConnections: () => Effect.void,
      listProjectMcpTools: () => [],
    } as any),
    Layer.succeed(SubagentRunnerService, {} as any),
    // ToolEnvPort：把上面的具体服务适配成 agent 所需的工具执行期注入能力（同 layer.ts）
    ToolEnvLayer,
    // ToolCatalogPort：静态内置工具 + profile 工具 + MCP 工具的装配（同 layer.ts）
    ToolCatalogLayer,
  );
  return services;
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// 模拟真实 LLM 延迟：将 stream 分块与 response 放在宏任务上推进，
// 避免 producer fiber 在微任务队列中一口气跑完导致队列事件被丢弃。
function paceLlm(llm: any): any {
  const completeStream = llm.completeStream.bind(llm);
  llm.completeStream = (params: any, signal?: AbortSignal) => {
    const out = completeStream(params, signal);
    const rawStream = out.stream as AsyncGenerator<string>;
    out.stream = (async function* () {
      for await (const c of rawStream) {
        yield c;
        await tick();
      }
    })();
    out.response = Promise.resolve(out.response).then(async (r) => {
      await tick();
      return r;
    });
    return out;
  };
  return llm;
}

export async function runAgentTurn(
  mocks: HarnessMocks,
  opts: RunAgentOptions = {}
): Promise<{ events: AgentEvent[]; sessionId: string }> {
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
  let runRes: { stream: AsyncGenerator<AgentEvent>; sessionId: string };
  try {
    runRes = await Effect.runPromise(Effect.provide(program, appLayer) as any);
  } catch (err) {
    console.error('HARNESS-RUN-ERROR', err);
    throw err;
  }
  const { stream, sessionId } = runRes;
  const events: AgentEvent[] = [];
  try {
    for await (const e of stream) events.push(e);
  } catch (err) {
    console.error('HARNESS-STREAM-ERROR', err);
    throw err;
  }
  return { events, sessionId };
}
