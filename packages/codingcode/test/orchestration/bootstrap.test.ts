import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { bootstrapApplication } from '../../src/orchestration/bootstrap.js';
import { ToolService } from '../../src/tools/registry.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';
import { SubagentRegistry } from '../../src/subagent/registry.js';
import { SandboxService } from '../../src/sandbox/index.js';
import { McpService } from '../../src/mcp/index.js';
import { SkillService } from '../../src/skills/index.js';
import { SessionService } from '../../src/session/store.js';
import { AgentIdResolver } from '../../src/agent-state/agent-id.js';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';

const sandboxLayer = Layer.succeed(SandboxService, {
  initialize: () => Effect.void,
} as any);

const mcpLayer = Layer.succeed(McpService, {
  connectAll: (_: string) => Effect.void,
  disconnect: () => Effect.void,
  status: () => [],
} as any);

const skillLayer = Layer.succeed(SkillService, {
  loadAll: (_: string) => Effect.void,
  extractSkill: (input: string) => Effect.succeed([undefined, input] as const),
  list: () => [],
} as any);

const sessionLayer = Layer.succeed(SessionService, {} as any);

const agentIdLayer = Layer.succeed(AgentIdResolver, {
  resolve: (_: string) => 'test-agent-id',
} as any);

const approvalLayer = Layer.succeed(ApprovalService, {
  fork: (_: any) => Effect.succeed({} as any),
  check: () => Effect.succeed({ decision: 'allow' } as any),
} as any);

const hooksLayer = Layer.succeed(HookService, {
  emit: (_: any, _2: any) => Effect.void,
  emitDecision: (_: any, _2: any) => Effect.succeed({ decision: 'allow' } as any),
  on: () => () => {},
} as any);

const toolLayer = ToolService.Default;
const registryLayer = SubagentRegistry.Default;
const toolSearchLayer = ToolSearchService.Default.pipe(Layer.provide(toolLayer));

const testLayer = Layer.mergeAll(
  toolLayer,
  toolSearchLayer,
  registryLayer,
  sandboxLayer,
  mcpLayer,
  skillLayer,
  sessionLayer,
  agentIdLayer,
  approvalLayer,
  hooksLayer,
);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(testLayer) as any));
}

const EXPECTED_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'execute_command',
  'search_code', 'search_files', 'fetch_url', 'web_search',
  'todo_write', 'todo_read', 'tool_search', 'dispatch_agent',
];

describe('bootstrapApplication', () => {
  it('registers all 12 built-in tools', async () => {
    const program = Effect.gen(function* () {
      yield* bootstrapApplication('/fake/cwd');
      const tools = yield* ToolService;
      return tools.describeAll().map(t => t.name);
    });

    const registered = await run(program);

    for (const name of EXPECTED_TOOLS) {
      expect(registered, `expected ${name} to be registered`).toContain(name);
    }
  });

  it('registers EXPLORE and GENERAL built-in profiles', async () => {
    const program = Effect.gen(function* () {
      yield* bootstrapApplication('/fake/cwd');
      const registry = yield* SubagentRegistry;
      return registry.list().map(p => p.name);
    });

    const profiles = await run(program);

    expect(profiles).toContain('explore');
    expect(profiles).toContain('general');
  });

  it('calls mcp.connectAll with the given cwd', async () => {
    let capturedCwd: string | undefined;
    const trackingMcpLayer = Layer.succeed(McpService, {
      connectAll: (cwd: string) => Effect.sync(() => { capturedCwd = cwd; }),
      disconnect: () => Effect.void,
      status: () => [],
    } as any);

    const layer = Layer.mergeAll(
      toolLayer, toolSearchLayer, registryLayer,
      sandboxLayer, trackingMcpLayer, skillLayer,
      sessionLayer, agentIdLayer, approvalLayer, hooksLayer,
    );

    const program = bootstrapApplication('/project/root');
    await Effect.runPromise(program.pipe(Effect.provide(layer) as any));

    expect(capturedCwd).toBe('/project/root');
  });

  it('calls skill.loadAll with the given cwd', async () => {
    let capturedCwd: string | undefined;
    const trackingSkillLayer = Layer.succeed(SkillService, {
      loadAll: (cwd: string) => Effect.sync(() => { capturedCwd = cwd; }),
      extractSkill: (input: string) => Effect.succeed([undefined, input] as const),
      list: () => [],
    } as any);

    const layer = Layer.mergeAll(
      toolLayer, toolSearchLayer, registryLayer,
      sandboxLayer, mcpLayer, trackingSkillLayer,
      sessionLayer, agentIdLayer, approvalLayer, hooksLayer,
    );

    const program = bootstrapApplication('/project/root');
    await Effect.runPromise(program.pipe(Effect.provide(layer) as any));

    expect(capturedCwd).toBe('/project/root');
  });
});
