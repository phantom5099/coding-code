import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { McpService } from '../../src/mcp/index.js';
import { HookService } from '../../src/hooks/registry.js';

// Mock McpClient
vi.mock('../../src/mcp/client.js', () => {
  class MockMcpClient {
    connected = true;
    tools: string[] = [];
    transportType = 'stdio' as const;
    private _tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;

    constructor(public config: any) {
      this._tools = config._mockTools ?? [
        { name: 'query', description: 'Run a query', inputSchema: {} },
      ];
    }
    async connect() {}
    async listTools() {
      this.tools = this._tools.map((t) => t.name);
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
  resolveMcpConfig: vi.fn(() => []),
  resolveMcpDisabled: vi.fn(() => false),
}));

function makeHookLayer() {
  return Layer.succeed(HookService, {
    emit: () => Effect.void,
    emitDecision: () => Effect.succeed({ decision: 'allow' } as any),
    reloadUserHooks: () => Effect.void,
    disableHook: () => Effect.void,
    enableHook: () => Effect.void,
    attachSessionHooks: () => Effect.void,
    disposeSession: () => Effect.void,
    disposeProject: () => Effect.void,
  } as any);
}

const TEST_PROJECT = '/fake';
const TEST_SESSION = 'test-session';

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  const testLayer = Layer.mergeAll(
    makeHookLayer(),
    McpService.Default.pipe(Layer.provide(makeHookLayer()))
  );
  return Effect.runPromise(eff.pipe(Effect.provide(testLayer) as any));
}

describe('McpService granular methods', () => {
  let mockConfigs: any[];

  beforeEach(async () => {
    mockConfigs = [];
    const { resolveMcpConfig } = await import('../../src/mcp/config.js');
    (resolveMcpConfig as any).mockImplementation(() => mockConfigs);
  });

  it('connectServers connects only specified servers', async () => {
    mockConfigs = [
      {
        name: 'server-a',
        command: 'echo',
        _mockTools: [{ name: 'tool-a', description: 'A', inputSchema: {} }],
      },
      {
        name: 'server-b',
        command: 'echo',
        _mockTools: [{ name: 'tool-b', description: 'B', inputSchema: {} }],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      yield* mcp.connectServers(TEST_PROJECT, TEST_SESSION, ['server-a']);

      const toolNames = mcp.getServerToolNames(TEST_PROJECT, 'server-a');
      expect(toolNames).toContain('server-a:tool-a');

      const toolBNames = mcp.getServerToolNames(TEST_PROJECT, 'server-b');
      expect(toolBNames).toEqual([]);
    });

    await run(program);
  });

  it('disconnectServers removes tools and connection', async () => {
    mockConfigs = [
      {
        name: 'srv',
        command: 'echo',
        _mockTools: [{ name: 'do', description: 'Do', inputSchema: {} }],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      yield* mcp.connectServers(TEST_PROJECT, TEST_SESSION, ['srv']);
      expect(mcp.getServerToolNames(TEST_PROJECT, 'srv')).toContain('srv:do');

      yield* mcp.disconnectServers(TEST_PROJECT, TEST_SESSION, ['srv']);
      expect(mcp.getServerToolNames(TEST_PROJECT, 'srv')).toEqual([]);
    });

    await run(program);
  });

  it('lease prevents premature disconnect', async () => {
    mockConfigs = [
      {
        name: 'shared',
        command: 'echo',
        _mockTools: [{ name: 'op', description: 'Op', inputSchema: {} }],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      // Two sessions connect
      yield* mcp.connectServers(TEST_PROJECT, 'session-1', ['shared']);
      yield* mcp.connectServers(TEST_PROJECT, 'session-2', ['shared']);

      // First disconnect (lease 2 -> 1, should stay)
      yield* mcp.disconnectServers(TEST_PROJECT, 'session-1', ['shared']);
      expect(mcp.getServerToolNames(TEST_PROJECT, 'shared')).toContain('shared:op');

      // Second disconnect (lease 1 -> 0, should remove)
      yield* mcp.disconnectServers(TEST_PROJECT, 'session-2', ['shared']);
      expect(mcp.getServerToolNames(TEST_PROJECT, 'shared')).toEqual([]);
    });

    await run(program);
  });

  it('getServerToolNames returns namespaced names', async () => {
    mockConfigs = [
      {
        name: 'db',
        command: 'echo',
        _mockTools: [
          { name: 'query', description: 'Query', inputSchema: {} },
          { name: 'schema', description: 'Schema', inputSchema: {} },
        ],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      yield* mcp.connectServers(TEST_PROJECT, TEST_SESSION, ['db']);
      const names = mcp.getServerToolNames(TEST_PROJECT, 'db');

      expect(names).toEqual(['db:query', 'db:schema']);
    });

    await run(program);
  });

  it('getServerToolNames returns empty for unknown server', async () => {
    const program = Effect.gen(function* () {
      const mcp = yield* McpService;
      const names = mcp.getServerToolNames(TEST_PROJECT, 'nonexistent');
      expect(names).toEqual([]);
    });

    await run(program);
  });

  it('connectServers warns and skips unknown server name', async () => {
    mockConfigs = [
      {
        name: 'real-server',
        command: 'echo',
        _mockTools: [{ name: 'op', description: 'Op', inputSchema: {} }],
      },
    ];

    const program = Effect.gen(function* () {
      const mcp = yield* McpService;

      yield* mcp.connectServers(TEST_PROJECT, TEST_SESSION, ['real-server', 'nonexistent']);

      expect(mcp.getServerToolNames(TEST_PROJECT, 'real-server')).toContain('real-server:op');
      expect(mcp.getServerToolNames(TEST_PROJECT, 'nonexistent')).toEqual([]);
    });

    await run(program);
  });
});
