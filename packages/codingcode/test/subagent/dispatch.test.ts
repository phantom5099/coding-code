import { expect, it, describe, beforeEach, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { createDispatchAgentTool } from '../../src/tools/domains/subagent/dispatch.js';
import { HookService } from '../../src/hooks/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';
import type { AgentEvent } from '../../src/agent/types.js';

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

function makeRunStream(): AsyncGenerator<AgentEvent> {
  return (async function* () {
    yield { _tag: 'Done', content: 'done' } as AgentEvent;
  })();
}

function makeLayers() {
  return Layer.mergeAll(
    Layer.succeed(HookService, mockHooks as any),
    Layer.succeed(McpService, mockMcp as any),
    Layer.succeed(SubagentRunnerService, mockRunner as any)
  );
}

async function makeTool(): Promise<ToolDefinition> {
  return (await Effect.runPromise(
    createDispatchAgentTool().pipe(Effect.provide(makeLayers()) as any)
  )) as ToolDefinition;
}

describe('dispatch_agent (runner-based subagent spawn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('case 1: dispatches build subagent and returns the runner output', async () => {
    const tool = await makeTool();
    const out = await Effect.runPromise(
      tool.execute(
        { agent: 'build', prompt: 'go' },
        { projectPath: '/test', sessionId: 'parent-1' } as ToolExecCtx
      ) as any
    );
    expect(out).toBe('done');
  });

  it('case 2: forwards prompt, cwd and parent session id to the runner', async () => {
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'build', prompt: 'analyze this code' },
        { projectPath: '/test', sessionId: 'parent-1' } as ToolExecCtx
      ) as any
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
    const tool = await makeTool();
    const outcome = await Effect.runPromise(
      Effect.either(
        tool.execute(
          { agent: 'custom', prompt: 'go' },
          { projectPath: '/test', sessionId: 'parent-1' } as ToolExecCtx
        ) as any
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
    const tool = await makeTool();
    const outcome = await Effect.runPromise(
      Effect.either(
        tool.execute(
          { agent: 'build', prompt: 'go' },
          { projectPath: '/test', sessionId: 'parent-1' } as ToolExecCtx
        ) as any
      )
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      const err: any = outcome.left;
      expect(err.code).toBe('TOOL_NOT_ALLOWED');
    }
  });

  it('case 5: emits spawn.after and disposes the child session on completion', async () => {
    const tool = await makeTool();
    await Effect.runPromise(
      tool.execute(
        { agent: 'build', prompt: 'go' },
        { projectPath: '/test', sessionId: 'parent-1' } as ToolExecCtx
      ) as any
    );

    expect(mockHooks.emit).toHaveBeenCalledWith(
      'agent.subagent.spawn.after',
      expect.objectContaining({ childSessionId: 'child-1', profile: 'build' })
    );
    expect(mockHooks.disposeSession).toHaveBeenCalledWith('child-1');
    expect(mockMcp.disposeSession).toHaveBeenCalledWith('child-1');
  });
});
