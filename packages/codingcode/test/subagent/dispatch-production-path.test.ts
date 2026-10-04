import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { useTempHome } from '../helpers/temp-home.js';
import { AgentLayer } from '../../src/agent/agent.js';
import { ToolEnvLayer } from '../../src/agent/tool-env.js';
import { AgentService } from '../../src/agent/port.js';
import { SubagentRunnerLayer } from '../../src/subagent/subagent.js';
import { ApprovalService } from '../../src/approval/port.js';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { ContextService } from '../../src/context/port.js';
import { EventSinkLayer } from '../../src/sink/sink.js';
import { LLMService } from '../../src/llm/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { RulesService } from '../../src/rules/port.js';
import { SkillService } from '../../src/skills/port.js';
import { ToolExecutorLayer } from '../../src/tools/tools.js';
import { SessionLayer } from '../../src/session/session.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { TodoService } from '../../src/todo/port.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath } from '../../src/core/path.js';
import { projectBaseDir } from '../helpers/project-base.js';
import { transcriptPathFor } from '../../src/context/context.js';
import type { SessionMetaEvent, SessionRef, ToolResultEvent } from '../../src/contracts/session.js';
import type { Message } from '../../src/contracts/types.js';
import type { LLMStreamPart } from '../../src/contracts/provider.js';
import type { FrameBody, ToolOutcome } from '../../src/contracts/frame.js';

/**
 * Scripted LLM: the parent turn asks for dispatch_agent, the child turn answers,
 * then the parent turn wraps up. Ordering is fixed because the delegated turn
 * runs synchronously inside the tool execution.
 */
const script: LLMStreamPart[][] = [];
let call = 0;

const LLMMock = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({ content: '' }),
  completeStream: () =>
    (async function* () {
      const parts = script[call++] ?? [{ type: 'end' as const }];
      for (const p of parts) yield p;
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

interface Draining {
  text: string;
  toolResults: Array<{ id: string; name: string; outcome: ToolOutcome }>;
  endReason: string;
}

function drain(stream: AsyncGenerator<FrameBody>): Effect.Effect<Draining, Error> {
  return Effect.async<Draining, Error>((resume) => {
    (async () => {
      const out: Draining = { text: '', toolResults: [], endReason: 'unknown' };
      try {
        for await (const body of stream) {
          if (body.family === 'event') {
            if (body.event.type === 'text_delta') out.text += body.event.text;
            if (body.event.type === 'tool_result') {
              out.toolResults.push({
                id: body.event.id,
                name: body.event.name,
                outcome: body.event.outcome,
              });
            }
          } else if (body.family === 'transition' && body.transition.to === 'end') {
            out.endReason = body.transition.reason;
          }
        }
        resume(Effect.succeed(out));
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

// 真实的工具执行层：dispatch_agent 的参数解析与 ctx 装配都走生产代码
const ToolExecutorWithDeps = ToolExecutorLayer.pipe(Layer.provide(HookMock));

const AgentDeps = Layer.mergeAll(
  SessionLayer,
  ToolExecutorWithDeps,
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
    getHistory: (ref: SessionRef) => Effect.sync(() => readMessages(transcriptPathFor(ref))),
    absorb: () => Effect.void,
    compact: () => Effect.succeed({ didCompress: false, released: 0, promptEstimate: 0 }),
    dispose: () => Effect.void,
  } as any),
  EventSinkLayer,
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
const SubagentWired = SubagentRunnerLayer.pipe(Layer.provide(AgentWired));

const Runtime = Layer.mergeAll(
  AgentWired,
  SubagentWired,
  SessionLayer,
  ToolExecutorWithDeps,
  HookMock,
  McpMock,
  TodoMock
);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(Runtime as any)) as any);
}

describe('dispatch_agent on the production path (parent turn -> tool -> subagent turn)', () => {
  useTempHome('codingcode-test-prod-path-home-');

  let projectBase: string;
  let cwd: string;

  beforeEach(() => {
    projectBase = projectBaseDir();
    mkdirSync(projectBase, { recursive: true });
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-test-prod-path-cwd-'));
    script.length = 0;
    call = 0;
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it('delegates without CONFIG_MISSING and lands the child transcript under the parent', async () => {
    script.push(
      [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'dispatch_agent',
          arguments: { agentName: 'reviewer', prompt: 'inspect the module' },
        },
        { type: 'end' },
      ],
      // 子代理的那一回合
      [{ type: 'text', text: 'child answer' }, { type: 'end' }],
      // 父代理收尾
      [{ type: 'text', text: 'parent done' }, { type: 'end' }]
    );

    const { drained, parentId } = await run(
      Effect.gen(function* () {
        const agent = yield* AgentService;
        const { stream, sessionId } = yield* agent.runTurn('please delegate', {
          cwd,
          model: 'test-model',
          activeProfile: 'build',
          permissionMode: 'ask',
        });
        const drained = yield* drain(stream);
        return { drained, parentId: sessionId };
      })
    );

    expect(drained.endReason).toBe('done');

    const delegated = drained.toolResults.find((r) => r.name === 'dispatch_agent');
    expect(delegated).toBeDefined();
    // 阶段一之前这里必然是 [Error: CONFIG_MISSING]，父会话的 activeProfile 到不了 dispatch_agent
    expect(delegated!.outcome.status).toBe('ok');
    if (delegated!.outcome.status === 'ok') {
      expect(delegated!.outcome.output).toContain('child answer');
    }

    const sessionsRoot = join(projectBase, encodeProjectPath(normalizePath(cwd)), 'sessions');
    const subagentDir = join(sessionsRoot, parentId, 'subagents');
    expect(existsSync(subagentDir)).toBe(true);
    const childFiles = readdirSync(subagentDir).filter((f) => f.endsWith('.jsonl'));
    expect(childFiles).toHaveLength(1);

    const childEvents = readHistory(join(subagentDir, childFiles[0]!));
    const meta = childEvents[0] as SessionMetaEvent;
    expect(meta.type).toBe('session_meta');
    expect(meta.agentName).toBe('reviewer');
    expect(meta.parentSessionId).toBe(parentId);
    expect(childEvents.some((e) => e.type === 'assistant')).toBe(true);

    // 父转录里留下了这次委派的调用与结果
    const parentEvents = readHistory(join(sessionsRoot, `${parentId}.jsonl`));
    const toolResult = parentEvents.find(
      (e) => e.type === 'tool_result' && e.toolName === 'dispatch_agent'
    ) as ToolResultEvent | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.output).toContain('child answer');
  }, 30_000);
});
