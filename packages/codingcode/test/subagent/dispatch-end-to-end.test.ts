import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { ToolCatalogLayer } from '../../src/agent/tool-catalog.js';
import { AgentService } from '../../src/agent/port.js';
import {
  SessionPort,
  ToolExecutorPort,
  CheckpointPort,
  HookPort,
  ApprovalPort,
  SkillPort,
  McpPort,
  ContextPort,
  MemoryPort,
  LlmPort,
  RulesPort,
  TodoPort,
} from '../../src/agent/deps.js';
import { SessionLayer } from '../../src/session/session.js';
import { SessionService } from '../../src/session/port.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { TodoService } from '../../src/todo/port.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath, setProjectBaseDir, computePaths } from '../../src/core/path.js';
import type { Message } from '../../src/core/types.js';
import type { LLMClient } from '../../src/llm/client.js';
import { Result } from '../../src/core/result.js';

function makeMockLLM(content: string): LLMClient {
  return {
    complete: () => Effect.succeed({ content, finishReason: 'stop' as const }),
    completeStream: () => ({
      stream: (async function* () {
        yield content;
      })(),
      response: Promise.resolve(Result.ok({ content, finishReason: 'stop' as const })),
    }),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 128000,
      supportsToolCalling: false,
      supportsStreaming: true,
    },
  };
}

/** Read events back into the message list an LLM would see (like context.assemblePayload). */
function readMessages(transcriptPath: string): Message[] {
  return readHistory(transcriptPath).flatMap((e) => {
    if (e.type === 'user') return [{ role: 'user', content: e.content }] as Message[];
    if (e.type === 'assistant')
      return [{ role: 'assistant', content: e.content, tool_calls: e.toolCalls }] as Message[];
    if (e.type === 'tool_result')
      return [
        {
          role: 'tool',
          content: e.output ?? '',
          tool_call_id: e.toolCallId,
          tool_name: e.toolName,
        } as Message,
      ];
    return [];
  });
}

/**
 * Self-contained runtime used by the end-to-end tests: real AgentLayer +
 * real file-backed SessionLayer, everything else mocked. This mirrors how
 * the app is wired in layer.ts while keeping each dependency explicit.
 */
// Real SessionService narrowed to the Agent's SessionPort (mirrors layer.ts's adapter).
const SessionPortLayer = Layer.effect(SessionPort, Effect.gen(function* () {
  const svc = yield* SessionService;
  return {
    load: svc.load.bind(svc),
    create: svc.create.bind(svc),
    recordUser: svc.recordUser.bind(svc),
    recordSystem: svc.recordSystem.bind(svc),
    recordAssistant: svc.recordAssistant.bind(svc),
    recordToolResult: svc.recordToolResult.bind(svc),
    setPermissionMode: svc.setPermissionMode.bind(svc),
    setActiveProfile: svc.setActiveProfile.bind(svc),
  };
})).pipe(Layer.provide(SessionLayer));

// Narrow agent ports + TodoService required to build the real AgentLayer.
const AgentDeps = Layer.mergeAll(
  SessionPortLayer,
  Layer.succeed(ToolExecutorPort, { executeBatch: () => Effect.succeed([]) } as any),
  Layer.succeed(CheckpointPort, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
  } as any),
  Layer.succeed(HookPort, {
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
    disposeSession: () => Effect.void,
  } as any),
  Layer.succeed(ApprovalPort, {
    evaluate: () => Effect.succeed({ type: 'allow' }),
  } as any),
  Layer.succeed(SkillPort, {
    extractSkill: (_cwd: string, query: string) => Effect.succeed([undefined, query]),
  } as any),
  Layer.succeed(McpPort, {
    syncConnections: () => Effect.void,
    listProjectMcpTools: () => [],
  } as any),
  Layer.succeed(ContextPort, {
    assemblePayload: async (transcriptPath: string) => ({
      messages: readMessages(transcriptPath),
    }),
  } as any),
  Layer.succeed(MemoryPort, {
    loadMemoryForPrompt: () => '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  } as any),
  Layer.succeed(LlmPort, {
    getLLMClient: () => Effect.succeed(makeMockLLM('subagent final answer') as LLMClient),
  } as any),
  Layer.succeed(RulesPort, {
    getAllRules: () => '',
    evictProjectRules: () => {},
  } as any),
  Layer.succeed(TodoPort, { read: () => [] } as any),
  // ToolEnvPort 在 getToolEnv 运行时从外层 Runtime 解析具体服务（见 Runtime 定义）
  ToolEnvLayer,
  // ToolCatalogPort：静态内置 + profile 工具的装配（同 layer.ts）
  ToolCatalogLayer
);

// Real AgentService built on the real SessionPort + stubbed narrow ports.
const AgentWired = AgentLayer.pipe(Layer.provide(AgentDeps as any));

// Runtime exposed to the tests: real AgentService + SessionService, plus the
// full services the dispatch_agent tool's execute pulls from the environment.
const Runtime = Layer.mergeAll(
  AgentWired,
  SessionLayer,
  Layer.succeed(HookService, {
    register: () => Effect.succeed(() => {}),
    registerDecision: () => Effect.succeed(() => {}),
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
    reloadUserHooks: () => Effect.succeed(undefined),
    disposeSession: () => Effect.void,
  } as any),
  Layer.succeed(McpService, {
    syncConnections: () => Effect.void,
    listProjectMcpTools: () => [],
  } as any),
  Layer.succeed(SubagentRunnerService, {} as any),
  // ToolEnvLayer.getToolEnv 运行时从外层解析 TodoService（工具执行期依赖）
  Layer.succeed(TodoService, { read: () => [], write: () => {}, reset: () => {} } as any)
);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(Runtime as any)) as any);
}

/** Consume an event stream to completion (mirrors what dispatch.ts does). */
function drainStream(stream: AsyncGenerator<any>): Effect.Effect<string, Error> {
  return Effect.async<string, Error>((resume) => {
    (async () => {
      let content = '';
      try {
        for await (const event of stream) {
          if (event._tag === 'Done') content = event.content;
          else if (event._tag === 'Error') {
            resume(Effect.fail(new Error(`subagent failed: ${event.error.message}`)));
            return;
          }
        }
        resume(Effect.succeed(content));
      } catch (e) {
        resume(Effect.fail(e instanceof Error ? e : new Error(String(e))));
      }
    })();
  });
}

describe('subagent run end-to-end (session transcript is read by the agent loop)', () => {
  let projectBase: string;
  let cwd: string;

  beforeEach(() => {
    projectBase = mkdtempSync(join(tmpdir(), 'codingcode-test-e2e-'));
    setProjectBaseDir(projectBase);
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-test-cwd-'));
  });

  afterEach(() => {
    if (existsSync(projectBase)) rmSync(projectBase, { recursive: true, force: true });
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it('runSubagent drives the agent loop and persists the transcript it reads', async () => {
    const result = await run(
      Effect.gen(function* () {
        const agent = yield* AgentService;
        const session = yield* SessionService;
        const { stream, sessionId } = yield* agent.runTurn('analyze this code', {
          cwd,
          activeProfile: 'build',
          permissionMode: 'default',
        });
        const content = yield* drainStream(stream);
        const state = yield* session.load(normalizePath(cwd), sessionId);
        return { content, sessionId, transcriptPath: computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath };
      })
    );

    expect(typeof result.sessionId).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    expect(existsSync(result.transcriptPath)).toBe(true);

    const events = readHistory(result.transcriptPath);

    // First event: session_meta (written by session.create in the runner path)
    expect(events[0]!.type).toBe('session_meta');

    // The user prompt recorded before the agentLoop started. If agentLoop
    // read the wrong path, this event is invisible to the LLM and the
    // assistant response never lands.
    const userEv = events.find((e) => e.type === 'user');
    expect(userEv).toBeDefined();
    if (userEv && userEv.type === 'user') {
      expect(userEv.content).toBe('analyze this code');
    }

    // The LLM's reply lands on disk — proof that agentLoop read the jsonl.
    const assistantEv = events.find((e) => e.type === 'assistant');
    expect(assistantEv).toBeDefined();
  }, 30_000);

  it('child session created under a parent does NOT produce a flat <sessions>/<childId>.jsonl (old bug regression)', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const parent = yield* session.create(cwd, {
          model: 'parent-model',
          activeProfile: 'build',
          permissionMode: 'default',
        });
        const child = yield* session.create(
          cwd,
          { model: 'child-model', activeProfile: 'build', permissionMode: 'default' },
          { parentSessionId: parent.sessionId, agentName: 'build' }
        );
        return { parentId: parent.sessionId, childId: child.sessionId };
      })
    );

    const sessionsRoot = join(projectBase, encodeProjectPath(normalizePath(cwd)), 'sessions');
    const subagentDir = join(sessionsRoot, result.parentId, 'subagents');
    const nestedFiles = readdirSync(subagentDir).filter((f) => f.endsWith('.jsonl'));
    expect(nestedFiles).toContain(`${result.childId}.jsonl`);

    // The wrong-path location MUST NOT contain the child's jsonl. If it did,
    // some code constructed the path without parentSessionId.
    const flatChildPath = join(sessionsRoot, `${result.childId}.jsonl`);
    expect(existsSync(flatChildPath)).toBe(false);
  }, 30_000);
});
