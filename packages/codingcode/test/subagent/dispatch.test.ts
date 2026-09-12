import { expect, it, describe, beforeEach, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { dispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import type { ToolExecCtx } from '../../src/tools/types.js';
import type { FrameBody } from '../../src/core/frame.js';

const mockHooks = {
  register: () => Effect.succeed(() => {}),
  registerDecision: () => Effect.succeed(() => {}),
  emit: vi.fn(() => Effect.succeed(undefined)),
  emitDecision: vi.fn(() => Effect.succeed(null)),
  reloadUserHooks: () => Effect.succeed(undefined),
  disposeSession: vi.fn(() => Effect.succeed(undefined)),
};

const mockMcp = {
  connectServers: () => Effect.void,
  syncConnections: () => Effect.void,
  listProjectMcpTools: () => [],
  disposeSession: vi.fn(() => Effect.succeed(undefined)),
};

const mockRunner = {
  runSubagent: vi.fn(() =>
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
    Layer.succeed(McpService, mockMcp as any),
    Layer.succeed(SubagentRunnerService, mockRunner as any)
  );
}

function runTool(args: unknown, ctx: ToolExecCtx): Promise<string> {
  return Effect.runPromise(
    dispatchAgentTool.execute(args, ctx).pipe(Effect.provide(makeLayers()))
  );
}

describe('dispatch_agent (runner-based subagent spawn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('case 1: dispatches build subagent and returns the runner output', async () => {
    const out = await runTool(
      { agent: 'build', prompt: 'go' },
      { projectPath: '/test', sessionId: 'parent-1' }
    );
    expect(out).toBe('done');
  });

  it('case 2: forwards prompt, cwd and parent session id to the runner', async () => {
    await runTool(
      { agent: 'build', prompt: 'analyze this code' },
      { projectPath: '/test', sessionId: 'parent-1' }
    );

    expect(mockRunner.runSubagent).toHaveBeenCalledTimes(1);
    expect(mockRunner.runSubagent).toHaveBeenCalledWith(
      'analyze this code',
      expect.objectContaining({
        cwd: '/test',
        parentSessionId: 'parent-1',
        activeProfile: 'build',
        agentName: 'build',
      })
    );
  });

  it('case 3: rejects unknown profile (custom subagents removed)', async () => {
    const outcome = await Effect.runPromise(
      Effect.either(
        dispatchAgentTool
          .execute(
            { agent: 'custom', prompt: 'go' },
            { projectPath: '/test', sessionId: 'parent-1' }
          )
          .pipe(Effect.provide(makeLayers()))
      )
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      const err: any = outcome.left;
      expect(err.code).toBe('TOOL_EXECUTION_FAILED');
      expect(String(err.message)).toContain('Unknown subagent: custom');
    }
  });

  it('case 4: spawn.before deny hook blocks the dispatch', async () => {
    mockHooks.emitDecision.mockReturnValueOnce(
      Effect.succeed({ decision: 'deny' as const, reason: 'policy forbids it' }) as any
    );
    const outcome = await Effect.runPromise(
      Effect.either(
        dispatchAgentTool
          .execute(
            { agent: 'build', prompt: 'go' },
            { projectPath: '/test', sessionId: 'parent-1' }
          )
          .pipe(Effect.provide(makeLayers()))
      )
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      const err: any = outcome.left;
      expect(err.code).toBe('TOOL_NOT_ALLOWED');
    }
  });

  it('case 5: emits spawn.after and disposes the child session on completion', async () => {
    await runTool(
      { agent: 'build', prompt: 'go' },
      { projectPath: '/test', sessionId: 'parent-1' }
    );

    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.subagent.spawn.after',
      expect.objectContaining({ childSessionId: 'child-1', profile: 'build' })
    );
    expect(mockHooks.disposeSession).toHaveBeenCalledWith('child-1');
    expect(mockMcp.disposeSession).toHaveBeenCalledWith('child-1');
  });
});
