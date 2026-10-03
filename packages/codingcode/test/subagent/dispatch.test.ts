import { expect, it, describe, beforeEach, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { dispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { HookService } from '../../src/hooks/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import type { ToolExecCtx } from '../../src/contracts/tool.js';
import type { FrameBody } from '../../src/contracts/frame.js';

// 只有清单内的模型能被透传，测试内固定一份最小清单
vi.mock('../../src/infra/models.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/infra/models.js')>()),
  findModel: (id: string) =>
    id === 'child-model' ? ({ id: 'child-model@test', model: 'child-model' } as any) : null,
}));

const mockHooks = {
  emit: vi.fn(() => Effect.succeed(undefined)),
  emitDecision: vi.fn(() => Effect.succeed(null)),
  reloadUserHooks: () => Effect.succeed(undefined),
};

const mockRunner = {
  runSubagent: vi.fn((_input: string, _opts: Record<string, unknown>) =>
    Effect.succeed({ stream: makeRunStream(), sessionId: 'child-1' })
  ),
};

function makeRunStream(): AsyncGenerator<FrameBody> {
  return (async function* () {
    yield { family: 'event', event: { type: 'text_delta', text: 'done' } };
    yield { family: 'transition', transition: { to: 'end', reason: 'done' } };
  })();
}

function makeLayers() {
  return Layer.mergeAll(
    Layer.succeed(HookService, mockHooks as any),
    Layer.succeed(SubagentRunnerService, mockRunner as any)
  );
}

/** 工具执行上下文：activeProfile / model 由父会话透传，缺前者则派发不出来 */
function parentCtx(overrides: Partial<ToolExecCtx> = {}): ToolExecCtx {
  return {
    projectPath: '/test',
    sessionId: 'parent-1',
    activeProfile: 'build',
    model: 'parent-model',
    ...overrides,
  };
}

function runTool(args: unknown, ctx: ToolExecCtx): Promise<string> {
  return Effect.runPromise(
    dispatchAgentTool.execute(args, ctx).pipe(Effect.provide(makeLayers()))
  );
}

function runToolEither(args: unknown, ctx: ToolExecCtx) {
  return Effect.runPromise(
    Effect.either(dispatchAgentTool.execute(args, ctx).pipe(Effect.provide(makeLayers())))
  );
}

describe('dispatch_agent (runner-based subagent spawn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes agentName/prompt/model/systemPrompt and no dangling catalog pointer', () => {
    expect(dispatchAgentTool.description).not.toContain('Available Subagents');
    const schema = z.toJSONSchema(dispatchAgentTool.parameters) as any;
    expect(Object.keys(schema.properties).sort()).toEqual([
      'agentName',
      'model',
      'prompt',
      'systemPrompt',
    ]);
    expect(schema.required).toEqual(['agentName', 'prompt']);
  });

  it('case 1: dispatches a subagent and returns the runner output', async () => {
    const out = await runTool(
      { agentName: 'build', prompt: 'go' },
      parentCtx()
    );
    expect(out).toBe('done');
  });

  it('case 2: forwards prompt, cwd, parent session id, profile and bypass to the runner', async () => {
    await runTool(
      { agentName: 'reviewer', prompt: 'analyze this code' },
      parentCtx()
    );

    expect(mockRunner.runSubagent).toHaveBeenCalledTimes(1);
    expect(mockRunner.runSubagent).toHaveBeenCalledWith(
      'analyze this code',
      expect.objectContaining({
        cwd: '/test',
        parentSessionId: 'parent-1',
        activeProfile: 'build',
        agentName: 'reviewer',
        permissionMode: 'bypass',
      })
    );
  });

  it('case 3: passes model and systemPrompt through, inherits the turn model when model is omitted or not in the catalog', async () => {
    await runTool(
      { agentName: 'build', prompt: 'go', model: 'child-model', systemPrompt: 'CUSTOM PROMPT' },
      parentCtx()
    );
    expect(mockRunner.runSubagent).toHaveBeenLastCalledWith(
      'go',
      expect.objectContaining({ model: 'child-model', systemPrompt: 'CUSTOM PROMPT' })
    );

    mockRunner.runSubagent.mockClear();
    await runTool({ agentName: 'build', prompt: 'go' }, parentCtx());
    const omitted = mockRunner.runSubagent.mock.calls.at(-1)![1];
    expect(omitted.model).toBe('parent-model');
    expect(omitted.systemPrompt).toBeUndefined();

    mockRunner.runSubagent.mockClear();
    await runTool({ agentName: 'build', prompt: 'go', model: 'not-in-catalog' }, parentCtx());
    expect(mockRunner.runSubagent.mock.calls.at(-1)![1].model).toBe('parent-model');
  });

  it('case 4: accepts any non-empty agentName (no profile lookup)', async () => {
    const out = await runTool(
      { agentName: 'custom-name', prompt: 'go' },
      parentCtx()
    );
    expect(out).toBe('done');
    expect(mockRunner.runSubagent).toHaveBeenCalledWith(
      'go',
      expect.objectContaining({ agentName: 'custom-name' })
    );
  });

  it('case 5: fails with CONFIG_MISSING when the parent profile is missing', async () => {
    const outcome = await runToolEither(
      { agentName: 'build', prompt: 'go' },
      { projectPath: '/test', sessionId: 'parent-1', model: 'parent-model' }
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      const err: any = outcome.left;
      expect(err.code).toBe('CONFIG_MISSING');
      expect(String(err.message)).toContain('activeProfile');
    }
    expect(mockRunner.runSubagent).not.toHaveBeenCalled();
  });

  it('case 6: spawn.before deny hook blocks the dispatch', async () => {
    mockHooks.emitDecision.mockReturnValueOnce(
      Effect.succeed({ decision: 'deny' as const, reason: 'policy forbids it' }) as any
    );
    const outcome = await runToolEither(
      { agentName: 'build', prompt: 'go' },
      parentCtx()
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      const err: any = outcome.left;
      expect(err.code).toBe('TOOL_NOT_ALLOWED');
    }
  });

  it('case 7: emits spawn.after and complete carrying the child session id and agentName', async () => {
    await runTool(
      { agentName: 'reviewer', prompt: 'go' },
      parentCtx()
    );

    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.subagent.spawn.after',
      expect.objectContaining({ childSessionId: 'child-1', agentName: 'reviewer' })
    );
    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.objectContaining({ childSessionId: 'child-1', status: 'done' })
    );
  });

  it('case 8: a stream that ends with error fails the tool and skips complete', async () => {
    mockRunner.runSubagent.mockReturnValueOnce(
      Effect.succeed({
        stream: (async function* () {
          yield {
            family: 'transition',
            transition: { to: 'end', reason: 'error', error: { message: 'boom' } },
          };
        })() as AsyncGenerator<FrameBody>,
        sessionId: 'child-2',
      }) as any
    );

    const outcome = await runToolEither(
      { agentName: 'build', prompt: 'go' },
      parentCtx()
    );

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(String((outcome.left as any).message)).toContain('Subagent failed: boom');
    }
    expect(mockHooks.emit).not.toHaveBeenCalledWith(
      'agent.subagent.complete',
      expect.anything()
    );
  });
});
