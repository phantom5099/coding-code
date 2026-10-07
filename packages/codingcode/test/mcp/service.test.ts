import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { McpService } from '../../src/mcp/port.js';
import { McpLayer } from '../../src/mcp/mcp.js';

interface MockTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  readOnlyHint?: boolean;
}

// McpClient 桩：把实例留在 static 数组里，供测试断言建连/断连次数
vi.mock('../../src/mcp/client.js', () => {
  class MockMcpClient {
    static instances: MockMcpClient[] = [];
    connectCalls = 0;
    disconnectCalls = 0;
    private _tools: MockTool[];
    constructor(public config: any) {
      this._tools = config._mockTools ?? [
        { name: 'query', description: 'Run a query', inputSchema: {} },
      ];
      MockMcpClient.instances.push(this);
    }
    async connect() {
      this.connectCalls++;
      if (this.config._mockFail) throw new Error('boom');
    }
    async listTools() {
      return this._tools;
    }
    callTool(_name: string, _args: Record<string, unknown>) {
      return Effect.succeed('mock-result');
    }
    async disconnect() {
      this.disconnectCalls++;
    }
  }
  return { McpClient: MockMcpClient, McpError: class McpError extends Error {} };
});

vi.mock('../../src/mcp/config.js', () => ({
  resolveMcpConfig: vi.fn(() => []),
}));

const TEST_PROJECT = '/fake';

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(McpLayer)) as any);
}

/** 桩 client 的实际实例（vi.mock 工厂里的 static 数组） */
async function clients(): Promise<any[]> {
  const mod = await import('../../src/mcp/client.js');
  return (mod.McpClient as any).instances;
}

function tool(name: string, extra: Partial<MockTool> = {}): MockTool {
  return { name, description: name, inputSchema: {}, ...extra };
}

function cfg(name: string, tools: MockTool[], enabled?: boolean) {
  return {
    name,
    command: 'echo',
    ...(enabled === undefined ? {} : { enabled }),
    _mockTools: tools,
  };
}

/** 按声明序返回 `server:tool` 列表，便于断言 */
function specKeys(specs: Array<{ server: string; name: string }>): string[] {
  return specs.map((s) => `${s.server}:${s.name}`);
}

describe('McpService（syncConnections / listProjectMcpTools / status）', () => {
  let mockConfigs: any[];

  beforeEach(async () => {
    mockConfigs = [];
    (await clients()).length = 0;
    const { resolveMcpConfig } = await import('../../src/mcp/config.js');
    (resolveMcpConfig as any).mockImplementation(() => mockConfigs);
  });

  it('syncConnections 连接配置里全部启用的 server', async () => {
    mockConfigs = [cfg('server-a', [tool('tool-a')]), cfg('server-b', [tool('tool-b')])];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        const specs = yield* mcp.listProjectMcpTools(TEST_PROJECT);
        expect(specKeys(specs).sort()).toEqual(['server-a:tool-a', 'server-b:tool-b']);
      })
    );
  });

  it('enabled:false 的 server 既不建连也不出工具', async () => {
    mockConfigs = [cfg('on', [tool('op')]), cfg('off', [tool('nope')], false)];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        const specs = yield* mcp.listProjectMcpTools(TEST_PROJECT);
        expect(specKeys(specs)).toEqual(['on:op']);
      })
    );
    expect((await clients()).length).toBe(1);
  });

  it('重复调用 syncConnections 不会重复建连', async () => {
    mockConfigs = [cfg('srv', [tool('do')])];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        yield* mcp.syncConnections(TEST_PROJECT);
        const specs = yield* mcp.listProjectMcpTools(TEST_PROJECT);
        expect(specKeys(specs)).toEqual(['srv:do']);
      })
    );
    const created = await clients();
    expect(created.length).toBe(1);
    expect(created[0]!.connectCalls).toBe(1);
  });

  it('配置里消失的 server 会被断连并清掉工具', async () => {
    mockConfigs = [cfg('srv', [tool('do')])];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        expect(specKeys(yield* mcp.listProjectMcpTools(TEST_PROJECT))).toEqual(['srv:do']);

        mockConfigs = [];
        yield* mcp.syncConnections(TEST_PROJECT);
        expect(yield* mcp.listProjectMcpTools(TEST_PROJECT)).toEqual([]);
      })
    );
    const created = await clients();
    expect(created[0]!.disconnectCalls).toBe(1);
  });

  it('运行时改成 enabled:false：查询立刻过滤，syncConnections 负责断连', async () => {
    mockConfigs = [cfg('srv', [tool('do')])];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);

        mockConfigs = [cfg('srv', [tool('do')], false)];
        // 尚未 sync：连接还在，但 listProjectMcpTools 已按开关过滤
        expect(yield* mcp.listProjectMcpTools(TEST_PROJECT)).toEqual([]);

        yield* mcp.syncConnections(TEST_PROJECT);
        expect(yield* mcp.listProjectMcpTools(TEST_PROJECT)).toEqual([]);
      })
    );
    const created = await clients();
    expect(created[0]!.disconnectCalls).toBe(1);
  });

  it('建连失败的 server 被跳过，不影响同批其它 server', async () => {
    mockConfigs = [{ ...cfg('bad', [tool('x')]), _mockFail: true }, cfg('good', [tool('ok')])];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        expect(specKeys(yield* mcp.listProjectMcpTools(TEST_PROJECT))).toEqual(['good:ok']);
      })
    );
  });

  it('listProjectMcpTools 暴露纯数据 spec：原始 JSON Schema + readOnlyHint 透传 + execute 已绑 client', async () => {
    mockConfigs = [
      cfg('typed', [
        tool('query', {
          description: 'Query',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          readOnlyHint: true,
        }),
        // 未声明 readOnlyHint ⇒ fail-closed 为 false（并发调度依赖它）
        tool('write'),
      ]),
    ];

    await run(
      Effect.gen(function* () {
        const mcp = yield* McpService;
        yield* mcp.syncConnections(TEST_PROJECT);
        const specs = yield* mcp.listProjectMcpTools(TEST_PROJECT);

        expect(specs).toHaveLength(2);
        const query = specs[0]!;
        expect(query.server).toBe('typed');
        expect(query.name).toBe('query');
        expect(query.inputSchema).toMatchObject({
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        });
        expect(query.readOnlyHint).toBe(true);
        expect(specs[1]!.readOnlyHint).toBe(false);
        // execute 已绑定 client，zod 化留给 tools 层
        expect(yield* query.execute({ text: 'hello' })).toBe('mock-result');
      })
    );
  });
});
