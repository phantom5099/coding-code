import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { McpService } from '../../src/mcp/index.js';
import { ToolService } from '../../src/tools/registry.js';
import { HookService } from '../../src/hooks/registry.js';

// Mock McpClient
vi.mock('../../src/mcp/client.js', () => {
  class MockMcpClient {
    connected = true;
    tools: string[] = [];
    transportType = 'stdio' as const;
    private _tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;

    constructor(public config: any) {
      this._tools = config._mockTools ?? [
        { name: 'query', description: 'Run a query', inputSchema: {} },
      ];
    }
    async connect() {}
    async listTools() {
      this.tools = this._tools.map(t => t.name);
      return this._tools;
    }
    callTool(_name: string, _args: Record<string, unknown>) {
      return Effect.succeed('mock-result');
    }
    async disconnect() {}
  }
  return { McpClient: MockMcpClient, McpError: class McpError extends Error {} };
});

// Mock loadMcpConfig
vi.mock('../../src/mcp/config.js', () => ({
  loadMcpConfig: vi.fn(() => []),
}));

function makeToolLayer() {
  return ToolService.Default;
}

function makeHookLayer() {
  return Layer.succeed(HookService, {
    emit: () => Effect.void,
    emitDecision: () => Effect.succeed({ decision: 'allow' } as any),
    reloadUserHooks: () => Effect.void,
  } as any);
}

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  const testLayer = Layer.mergeAll(makeToolLayer(), makeHookLayer(), McpService.Default.pipe(
    Layer.provide(Layer.mergeAll(makeToolLayer(), makeHookLayer())),
  ));
  return Effect.runPromise(eff.pipe(Effect.provide(testLayer) as any));
}

describe('McpService granular methods', () => {
  let mockConfigs: any[];

  beforeEach(async () => {
    mockConfigs = [];
    const { loadMcpConfig } = await import('../../src/mcp/config.js');
    (loadMcpConfig as any).mockImplementation(() => mockConfigs);
  });

  it('connectServers connects only specified servers', async () => {
    mockConfigs = [
      { name: 'server-a', command: 'echo', _mockTools: [{ name: 'tool-a', description: 'A', inputSchema: {} }] },
      { name: 'server-b', command: 'echo', _mockTools: [{ name: 'tool-b', description: 'B', inputSchema: {} }] },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const tools = yield* ToolService;

      yield* mcp.connectServers(['server-a'], '/fake');

      // server-a tool should be registered with namespace
      const toolA = tools.getDef('server-a:tool-a');
      expect(toolA).toBeDefined();
      expect(toolA!.description).toContain('[MCP:server-a]');

      // server-b tool should NOT be registered
      const toolB = tools.getDef('server-b:tool-b');
      expect(toolB).toBeUndefined();
    });

    await run(program);
  });

  it('disconnectServers removes tools and connection', async () => {
    mockConfigs = [
      { name: 'srv', command: 'echo', _mockTools: [{ name: 'do', description: 'Do', inputSchema: {} }] },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const tools = yield* ToolService;

      yield* mcp.connectServers(['srv'], '/fake');
      expect(tools.getDef('srv:do')).toBeDefined();

      yield* mcp.disconnectServers(['srv']);
      expect(tools.getDef('srv:do')).toBeUndefined();
    });

    await run(program);
  });

  it('refCount prevents premature disconnect', async () => {
    mockConfigs = [
      { name: 'shared', command: 'echo', _mockTools: [{ name: 'op', description: 'Op', inputSchema: {} }] },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const tools = yield* ToolService;

      // First connection (refCount 0 -> 1)
      yield* mcp.connectServers(['shared'], '/fake');
      // Second connection (refCount 1 -> 2)
      yield* mcp.connectServers(['shared'], '/fake');

      // First disconnect (refCount 2 -> 1, should stay)
      yield* mcp.disconnectServers(['shared']);
      expect(tools.getDef('shared:op')).toBeDefined();

      // Second disconnect (refCount 1 -> 0, should remove)
      yield* mcp.disconnectServers(['shared']);
      expect(tools.getDef('shared:op')).toBeUndefined();
    });

    await run(program);
  });

  it('getServerToolNames returns namespaced names', async () => {
    mockConfigs = [
      {
        name: 'db', command: 'echo',
        _mockTools: [
          { name: 'query', description: 'Query', inputSchema: {} },
          { name: 'schema', description: 'Schema', inputSchema: {} },
        ],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      yield* mcp.connectServers(['db'], '/fake');
      const names = mcp.getServerToolNames('db');

      expect(names).toEqual(['db:query', 'db:schema']);
    });

    await run(program);
  });

  it('getServerToolNames returns empty for unknown server', async () => {
    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const names = mcp.getServerToolNames('nonexistent');
      expect(names).toEqual([]);
    });

    await run(program);
  });

  it('connectServers warns and skips unknown server name', async () => {
    mockConfigs = [
      { name: 'real-server', command: 'echo', _mockTools: [{ name: 'op', description: 'Op', inputSchema: {} }] },
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const tools = yield* ToolService;

      yield* mcp.connectServers(['real-server', 'nonexistent'], '/fake');

      // real-server should be connected
      expect(tools.getDef('real-server:op')).toBeDefined();
      // nonexistent should not
      expect(mcp.getServerToolNames('nonexistent')).toEqual([]);
    });

    await run(program);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    warnSpy.mockRestore();
  });
});
