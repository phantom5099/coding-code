import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { AppLayer } from '../../src/layer.js';
import { SessionService } from '../../src/session/store.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { readHistory } from '../../src/session/file-ops.js';
import { encodeProjectPath, normalizePath, setProjectBaseDir } from '../../src/core/path.js';
import type { LLMClient } from '../../src/llm/client.js';
import { Result } from '../../src/core/result.js';

const TestLLMLayer = Layer.succeed(
  LLMFactoryService,
  ({
    listModels: () => Effect.succeed([]),
    findModel: () => Effect.succeed(null),
    getActiveEntry: () => Effect.fail(new Error('no active')),
    switchModel: () => Effect.fail(new Error('no models')),
    getLLMClient: () => Effect.succeed(makeMockLLM('subagent final answer')),
    createClient: () => Effect.succeed(makeMockLLM('subagent final answer')),
  } as any)
);

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

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(
    eff.pipe(Effect.provide(AppLayer as any), Effect.provide(TestLLMLayer)) as any
  );
}

describe('dispatch_agent end-to-end (subagent reads its own jsonl)', () => {
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

  it('subagent transcriptPath is <parent>/subagents/<child>.jsonl and agentLoop reads it', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const runtime = yield* ProjectRuntimeService;

        yield* runtime.prepareProject(cwd);
        const parent = yield* session.create(cwd, {
          model: 'parent-model',
          mode: 'build',
          permissionMode: 'default',
        });

        const dispatchTool = yield* createDispatchAgentTool();
        const output = yield* dispatchTool.execute(
          { agent: 'explore', prompt: 'analyze this code' },
          { projectPath: cwd, sessionId: parent.sessionId } as any
        );
        return { output, parentId: parent.sessionId };
      })
    );

    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);

    const sessionsRoot = join(
      projectBase,
      encodeProjectPath(normalizePath(cwd)),
      'sessions'
    );
    const subagentDir = join(sessionsRoot, result.parentId, 'subagents');
    expect(existsSync(subagentDir)).toBe(true);

    const files = readdirSync(subagentDir).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBeGreaterThan(0);

    const childTranscriptPath = join(subagentDir, files[0]!);
    const events = readHistory(childTranscriptPath);

    // First event: session_meta (written by session.create in dispatch.ts)
    expect(events[0]!.type).toBe('session_meta');

    // The user prompt recorded by dispatch.ts BEFORE invoking the runner.
    // If agentLoop reads the wrong path, this event is invisible to the LLM,
    // and the assistant response never lands.
    const userEv = events.find((e) => e.type === 'user');
    expect(userEv).toBeDefined();
    if (userEv && userEv.type === 'user') {
      expect(userEv.content).toBe('analyze this code');
    }

    // The LLM's reply lands on disk — proof that agentLoop read the jsonl,
    // saw the user event, and emitted a real response.
    const assistantEv = events.find((e) => e.type === 'assistant');
    expect(assistantEv).toBeDefined();
  }, 30_000);

  it('child session id does NOT produce a flat <sessions>/<childId>.jsonl (old bug regression)', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const runtime = yield* ProjectRuntimeService;
        yield* runtime.prepareProject(cwd);
        const parent = yield* session.create(cwd, {
          model: 'parent-model',
          mode: 'build',
          permissionMode: 'default',
        });
        const dispatchTool = yield* createDispatchAgentTool();
        yield* dispatchTool.execute(
          { agent: 'explore', prompt: 'p' },
          { projectPath: cwd, sessionId: parent.sessionId } as any
        );
        return { parentId: parent.sessionId };
      })
    );

    const sessionsRoot = join(
      projectBase,
      encodeProjectPath(normalizePath(cwd)),
      'sessions'
    );
    const subagentDir = join(sessionsRoot, result.parentId, 'subagents');
    const childFiles = readdirSync(subagentDir).filter((f) => f.endsWith('.jsonl'));
    const childId = childFiles[0]!.replace('.jsonl', '');

    // The wrong-path location (the bug from 3d493e4) MUST NOT contain the
    // child's jsonl. If it did, some code constructed the path without
    // parentSessionId.
    const flatChildPath = join(sessionsRoot, `${childId}.jsonl`);
    expect(existsSync(flatChildPath)).toBe(false);
  }, 30_000);
});
