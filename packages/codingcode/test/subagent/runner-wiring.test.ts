import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { useTempHome } from '../helpers/temp-home.js';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { SubagentRunnerLayer } from '../../src/subagent/subagent.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { ApprovalService } from '../../src/approval/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { ContextService } from '../../src/context/port.js';
import { EventSinkLayer } from '../../src/sink/sink.js';
import { MailboxLayer } from '../../src/session/mailbox.js';
import { LLMService } from '../../src/llm/port.js';
import { AgentError } from '../../src/core/error.js';
import { MemoryService } from '../../src/memory/port.js';
import { RulesService } from '../../src/rules/port.js';
import { SkillService } from '../../src/skills/port.js';
import { ToolExecutorService } from '../../src/tools/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { SessionService } from '../../src/session/port.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { TodoService } from '../../src/todo/port.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath } from '../../src/core/path.js';
import { computePaths } from '../../src/session/paths.js';
import { transcriptPathFor } from '../../src/context/context.js';
import { projectBaseDir } from '../helpers/project-base.js';
import type { SessionMetaEvent, SessionRef } from '../../src/contracts/session.js';
import type { Message } from '../../src/contracts/types.js';
import type { LLMRequest } from '../../src/contracts/provider.js';
import type { FrameBody } from '../../src/contracts/frame.js';

const CHILD_MODEL = 'child-model';
const PARENT_MODEL = 'parent-model';

/** 记录每次推理请求：system 是那次回合真正用的系统提示词，model 是本次请求的模型值 */
interface Recorder {
  calls: Array<{ system: string; model: string }>;
}

const rec: Recorder = { calls: [] };
const CHILD_ANSWER = 'child answer';

/** 未命中即失败（与 LlmLayer 的 entryFor 同语义）；空模型同样不是合法模型 */
const LLMMock = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({ content: CHILD_ANSWER }),
  completeStream: (req: LLMRequest, model: string) =>
    (async function* () {
      const target = model?.trim() ?? '';
      if (target !== CHILD_MODEL) {
        throw new AgentError('CONFIG_INVALID', `Model "${target}" not found in models.json`);
      }
      rec.calls.push({ system: req.system ?? '', model: target });
      yield { type: 'text' as const, text: CHILD_ANSWER };
      yield { type: 'end' as const };
    })(),
} as any);

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

/** Drain a frame stream and return the accumulated assistant text. */
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

const McpMock = Layer.succeed(McpService, {
  syncConnections: () => Effect.void,
  listProjectMcpTools: () => Effect.succeed([]),
} as any);

const HookMock = Layer.succeed(HookService, {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
  reloadUserHooks: () => Effect.succeed(undefined),
} as any);

const TodoMock = Layer.succeed(TodoService, { read: () => [], write: () => {}, reset: () => {} } as any);

const AgentDeps = Layer.mergeAll(
  SessionLayer,
  Layer.succeed(ToolExecutorService, {
    executeBatch: () => Effect.succeed([]),
    prepare: () => Effect.succeed({ tools: [], lookup: () => undefined }),
  } as any),
  Layer.succeed(CheckpointService, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
  } as any),
  Layer.succeed(ApprovalService, {
    evaluate: () => Effect.succeed({ type: 'allow' }),
  } as any),
  Layer.succeed(SkillService, {
    getAll: () => Effect.succeed([]),
    readContent: () => Effect.succeed(''),
  } as any),
  Layer.succeed(ContextService, {
    getHistory: (ref: SessionRef) => Effect.sync(() => readMessages(transcriptPathFor(ref))),
    absorb: () => Effect.void,
    compact: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
    dispose: () => Effect.void,
  } as any),
  EventSinkLayer,
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
  McpMock,
  TodoMock,
  ToolEnvLayer
);

const AgentWired = AgentLayer.pipe(Layer.provide(AgentDeps as any));
// 真实 SubagentRunnerLayer：这一层到 agent.runTurn 的参数折叠正是阶段一要修的地方
const SubagentWired = SubagentRunnerLayer.pipe(Layer.provide(AgentWired));

const Runtime = Layer.mergeAll(AgentWired, SubagentWired, SessionLayer, HookMock, McpMock, TodoMock);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(Runtime as any)) as any);
}

describe('subagent runner wiring (child session mounts under the parent)', () => {
  useTempHome('codingcode-test-runner-home-');

  let projectBase: string;
  let cwd: string;

  beforeEach(() => {
    projectBase = projectBaseDir();
    mkdirSync(projectBase, { recursive: true });
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-test-runner-cwd-'));
    rec.calls.length = 0;
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  /** Create a parent session, then run one subagent turn under it. */
  function spawnChild(opts: { model?: string; systemPrompt?: string; agentName?: string }) {
    return run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const runner = yield* SubagentRunnerService;
        const parent = yield* session.create(cwd, {
          model: PARENT_MODEL,
          activeProfile: 'build',
          permissionMode: 'askBeforeExec',
        });
        const { stream, sessionId } = yield* runner.runSubagent('do the thing', {
          cwd,
          activeProfile: 'build',
          parentSessionId: parent.sessionId,
          agentName: opts.agentName ?? 'reviewer',
          model: opts.model ?? CHILD_MODEL,
          ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
        });
        const content = yield* drainStream(stream);
        return { parentId: parent.sessionId, childId: sessionId, content };
      })
    );
  }

  function pathsFor(childId: string, parentId: string) {
    return computePaths(normalizePath(cwd), childId, parentId);
  }

  it('writes the child transcript under sessions/<parent>/subagents/ and reloads it with the parent id', async () => {
    const { parentId, childId, content } = await spawnChild({});

    const nested = pathsFor(childId, parentId).transcriptPath;
    expect(existsSync(nested)).toBe(true);
    expect(nested).toContain(join(parentId, 'subagents', `${childId}.jsonl`));

    const sessionsRoot = join(projectBase, encodeProjectPath(normalizePath(cwd)), 'sessions');
    expect(existsSync(join(sessionsRoot, `${childId}.jsonl`))).toBe(false);

    expect(content.length).toBeGreaterThan(0);
    const types = readHistory(nested).map((e) => e.type);
    expect(types[0]).toBe('session_meta');
    expect(types).toContain('user');
    expect(types).toContain('assistant');
  });

  it('records parentSessionId, agentName and the bypass permission mode in the child session', async () => {
    const { parentId, childId } = await spawnChild({ agentName: 'reviewer' });

    const meta = readHistory(pathsFor(childId, parentId).transcriptPath)[0] as SessionMetaEvent;
    expect(meta.parentSessionId).toBe(parentId);
    // permissionMode 默认 bypass：runSubagent 未传时由 runner 兜底
    expect(meta.permissionMode).toBe('bypass');
    expect(meta.agentName).toBe('reviewer');
  });

  it('reloads the child session through session.load when the parent id is supplied', async () => {
    const { parentId, childId } = await spawnChild({});

    const reloaded = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const ok = yield* Effect.either(
          session.load(normalizePath(cwd), childId, parentId)
        );
        const withoutParent = yield* Effect.either(session.load(normalizePath(cwd), childId));
        return { ok: ok._tag === 'Right' ? ok.right : null, withoutParent };
      })
    );

    expect(reloaded.ok).not.toBeNull();
    expect(reloaded.ok!.parentSessionId).toBe(parentId);
    expect(reloaded.ok!.cwd).toBe(normalizePath(cwd));

    // 不带父参会算成顶层路径，子会话因此找不到
    expect(reloaded.withoutParent._tag).toBe('Left');
    if (reloaded.withoutParent._tag === 'Left') {
      expect((reloaded.withoutParent.left as any).code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('forwards the requested model through to the LLM layer', async () => {
    await spawnChild({ model: CHILD_MODEL });
    expect(rec.calls.at(-1)!.model).toBe(CHILD_MODEL);
  });

  it('fails the child turn when the requested model is not in the catalog', async () => {
    await expect(spawnChild({ model: 'not-registered' })).rejects.toThrow(/not-registered/);
  });

  it('replaces only the middle section of the child system prompt', async () => {
    await spawnChild({ systemPrompt: 'CUSTOM-MIDDLE-MARKER' });
    const system = rec.calls.at(-1)!.system;

    expect(system).toContain('## Environment');
    expect(system).toContain('## System Notes');
    // profile 段被整段换掉：默认 build 提示词不再出现
    expect(system).not.toContain('How you work');

    const envIdx = system.indexOf('## Environment');
    const notesIdx = system.indexOf('## System Notes');
    const customIdx = system.indexOf('CUSTOM-MIDDLE-MARKER');
    expect(customIdx).toBeGreaterThan(envIdx);
    expect(customIdx).toBeLessThan(notesIdx);
  });
});
