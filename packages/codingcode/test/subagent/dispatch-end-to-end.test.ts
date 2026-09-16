import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { ToolCatalogLayer } from '../../src/agent/tool-catalog.js';
import { AgentService } from '../../src/agent/port.js';
import { ApprovalService } from '../../src/approval/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { ContextService } from '../../src/context/port.js';
import { LLMFactoryService } from '../../src/llm/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { RulesService } from '../../src/rules/port.js';
import { SkillService } from '../../src/skills/port.js';
import { ToolExecutorService } from '../../src/tools/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { SessionService } from '../../src/session/port.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { TodoService } from '../../src/todo/port.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath, setProjectBaseDir, computePaths } from '../../src/core/path.js';
import type { Message } from '../../src/contracts/types.js';
import type { LLMClient } from '../../src/contracts/provider.js';
import type { FrameBody } from '../../src/contracts/frame.js';

function makeMockLLM(content: string): LLMClient {
  return {
    complete: () => Effect.succeed({ content }),
    completeStream: () =>
      (async function* () {
        yield { type: 'text' as const, text: content };
        yield { type: 'end' as const };
      })(),
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
// agent 依赖的全部宽服务 stub。
const McpMock = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  listProjectMcpTools: () => Effect.succeed([]),
} as any);
const ToolCatalogWithMcp = ToolCatalogLayer.pipe(Layer.provide(McpMock));

const HookMock = Layer.succeed(HookService, {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
  disposeSession: () => Effect.void,
} as any);

const TodoMock = Layer.succeed(TodoService, { read: () => [], write: () => {}, reset: () => {} } as any);

const SubagentMock = Layer.succeed(SubagentRunnerService, {} as any);

const AgentDeps = Layer.mergeAll(
  SessionLayer,
  Layer.succeed(ToolExecutorService, { executeBatch: () => Effect.succeed([]) } as any),
  Layer.succeed(CheckpointService, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
  } as any),
  Layer.succeed(ApprovalService, {
    evaluate: () => Effect.succeed({ type: 'allow' }),
  } as any),
  Layer.succeed(SkillService, {
    extractSkill: (_cwd: string, query: string) => Effect.succeed([undefined, query]),
  } as any),
  Layer.succeed(ContextService, {
    willCompact: async () => false,
    assemblePayload: async (transcriptPath: string) => readMessages(transcriptPath),
  } as any),
  Layer.succeed(MemoryService, {
    loadMemoryForPrompt: () => '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  } as any),
  Layer.succeed(LLMFactoryService, {
    getLLMClient: () => Effect.succeed(makeMockLLM('subagent final answer') as LLMClient),
  } as any),
  Layer.succeed(RulesService, {
    getAllRules: () => '',
    evictProjectRules: () => {},
  } as any),
  HookMock,
  McpMock,
  TodoMock,
  SubagentMock,
  // ToolEnvPort 在 getToolEnv 运行时从外层 Runtime 解析具体服务（见 Runtime 定义）
  ToolEnvLayer,
  // ToolCatalogPort：静态内置 + profile 工具的装配（同 layer.ts）
  ToolCatalogWithMcp
);

// Real AgentService built on the real SessionService + stubbed wide services.
const AgentWired = AgentLayer.pipe(Layer.provide(AgentDeps as any));

// Runtime exposed to the tests: real AgentService + SessionService, plus the
// full services the dispatch_agent tool's execute pulls from the environment.
const Runtime = Layer.mergeAll(
  AgentWired,
  SessionLayer,
  HookMock,
  McpMock,
  SubagentMock,
  TodoMock
);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(Runtime as any)) as any);
}

/** Consume a frame stream to completion (mirrors what dispatch.ts does). */
function drainStream(stream: AsyncGenerator<FrameBody>): Effect.Effect<string, Error> {
  return Effect.async<string, Error>((resume) => {
    (async () => {
      let content = '';
      try {
        for await (const body of stream) {
          if (body.family === 'event' && body.event.type === 'text_delta') {
            content += body.event.text;
          } else if (
            body.family === 'transition' &&
            body.transition.to === 'end' &&
            body.transition.reason === 'error'
          ) {
            resume(Effect.fail(new Error(`subagent failed: ${body.transition.error.message}`)));
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
