import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Duration, Effect, Layer } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ToolExecutorLayer } from '../../src/tools/tools.js';
import { ToolExecutorService } from '../../src/tools/port.js';
import { HookService } from '../../src/hooks/port.js';
import { TodoService } from '../../src/todo/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { TOOLS_BY_NAME, createToolCatalog } from '../../src/tools/catalog.js';
import type { ToolCall, TodoItem } from '../../src/contracts/types.js';
import type { ToolResult } from '../../src/contracts/tool.js';
import type { McpToolSpec } from '../../src/contracts/mcp.js';
import type { HookPoint } from '../../src/contracts/hooks.js';
import type { FrameBody } from '../../src/contracts/frame.js';

// 桩 hook 在工具执行窗口内 sleep，把窗口拉宽到足以用「区间是否相交」判定并发/串行
const WINDOW_MS = 150;

interface Interval {
  name: string;
  callId: string;
  start: number;
  end: number;
}

interface Harness {
  intervals: Interval[];
  hookPoints: string[];
  todoStore: Map<string, TodoItem[]>;
  onAfter?: (toolName: string, afterIndex: number) => void;
  clear: () => void;
  layers: Layer.Layer<any>;
}

function makeHarness(): Harness {
  const h: Harness = {
    intervals: [],
    hookPoints: [],
    todoStore: new Map(),
    clear: () => {
      h.intervals.length = 0;
      h.hookPoints.length = 0;
      h.onAfter = undefined;
    },
    layers: undefined as unknown as Layer.Layer<any>,
  };

  const starts = new Map<string, number>();
  let afterIndex = 0;

  const hooks = {
    emit: (point: HookPoint, payload: Record<string, unknown>) =>
      Effect.gen(function* () {
        h.hookPoints.push(point);
        const callId = String(payload.callId ?? '');
        const toolName = String(payload.toolName ?? '');
        if (point === 'tool.execute.before') {
          starts.set(callId, Date.now());
          yield* Effect.sleep(Duration.millis(WINDOW_MS));
        } else if (point === 'tool.execute.after') {
          h.intervals.push({
            name: toolName,
            callId,
            start: starts.get(callId) ?? Date.now(),
            end: Date.now(),
          });
          h.onAfter?.(toolName, afterIndex++);
        }
      }),
    emitDecision: () => Effect.succeed(null),
    reloadUserHooks: () => Effect.succeed(undefined),
  };

  const todo = {
    read: (sessionId: string) => h.todoStore.get(sessionId) ?? [],
    write: (sessionId: string, plan: TodoItem[]) => {
      h.todoStore.set(sessionId, plan);
    },
    reset: () => {
      h.todoStore.clear();
    },
  };

  const mcp = {
    syncConnections: () => Effect.succeed(undefined),
    listProjectMcpTools: () => [],
    status: () => Effect.succeed([]),
  };

  const runner = {
    runSubagent: () =>
      Effect.succeed({ stream: makeSubagentStream(200), sessionId: 'child-1' }),
  };

  h.layers = Layer.mergeAll(
    Layer.succeed(HookService, hooks as any),
    Layer.succeed(TodoService, todo as any),
    Layer.succeed(McpService, mcp as any),
    Layer.succeed(SubagentRunnerService, runner as any)
  );
  return h;
}

function makeSubagentStream(delayMs: number): AsyncGenerator<FrameBody> {
  return (async function* () {
    await new Promise((r) => setTimeout(r, delayMs));
    yield { family: 'event', event: { type: 'text_delta', text: 'child-done' } };
    yield { family: 'transition', transition: { to: 'end', reason: 'done' } };
  })();
}

function tc(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args };
}

function runBatch(
  calls: ToolCall[],
  ctx: { projectPath: string; sessionId?: string; signal?: AbortSignal },
  h: Harness,
  mcpSpecs: McpToolSpec[] = []
): Promise<ToolResult[]> {
  const program = Effect.gen(function* () {
    const exec = yield* ToolExecutorService;
    // 只把内置名交给 catalog（去重）；MCP 工具名（含 `:`）由 spec 侧注册
    const builtinNames = [...new Set(calls.map((c) => c.name).filter((n) => TOOLS_BY_NAME.has(n)))];
    const catalog = yield* exec.prepare(builtinNames, mcpSpecs);
    return yield* exec.executeBatch(calls, ctx.sessionId, {
      projectPath: ctx.projectPath,
      signal: ctx.signal,
      toolLookup: catalog.lookup,
    });
  });
  return Effect.runPromise(
    program.pipe(Effect.provide(ToolExecutorLayer), Effect.provide(h.layers))
  );
}

function okOutput(r: ToolResult | undefined): string {
  if (!r) throw new Error('missing tool result');
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
  return r.output;
}

function intervalFor(h: Harness, callId: string): Interval {
  const found = h.intervals.find((i) => i.callId === callId);
  if (!found) throw new Error(`no execution interval recorded for callId=${callId}`);
  return found;
}

// 严格相交：端点相等不算重叠（串行时后一个的 start 可等于前一个的 end）
const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

describe('executeBatch 保序波次调度', () => {
  let dir: string;
  let h: Harness;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-concurrency-'));
    h = makeHarness();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('只读工具同批并发：三个 read_file 的执行区间两两重叠', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');
    await writeFile(join(dir, 'b.txt'), 'B');
    await writeFile(join(dir, 'c.txt'), 'C');

    const results = await runBatch(
      [
        tc('r1', 'read_file', { path: 'a.txt' }),
        tc('r2', 'read_file', { path: 'b.txt' }),
        tc('r3', 'read_file', { path: 'c.txt' }),
      ],
      { projectPath: dir },
      h
    );

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    const i1 = intervalFor(h, 'r1');
    const i2 = intervalFor(h, 'r2');
    const i3 = intervalFor(h, 'r3');
    expect(overlaps(i1, i2)).toBe(true);
    expect(overlaps(i1, i3)).toBe(true);
    expect(overlaps(i2, i3)).toBe(true);
  });

  it('同文件两次 edit_file：区间不相交且两处编辑都生效（旧行为会静默丢一次）', async () => {
    const file = join(dir, 'f.txt');
    await writeFile(file, 'AAA\nBBB\n');

    const results = await runBatch(
      [
        tc('e1', 'edit_file', { path: 'f.txt', old_string: 'AAA', new_string: 'XXX' }),
        tc('e2', 'edit_file', { path: 'f.txt', old_string: 'BBB', new_string: 'YYY' }),
      ],
      { projectPath: dir },
      h
    );

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(overlaps(intervalFor(h, 'e1'), intervalFor(h, 'e2'))).toBe(false);

    const content = await readFile(file, 'utf-8');
    expect(content).toContain('XXX');
    expect(content).toContain('YYY');
    expect(content).not.toContain('AAA');
    expect(content).not.toContain('BBB');
  });

  it('结果按声明顺序回填：命令与只读混批不再跨组重排', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');

    const results = await runBatch(
      [
        tc('c1', 'execute_command', { command: 'echo hi' }),
        tc('r1', 'read_file', { path: 'a.txt' }),
      ],
      { projectPath: dir },
      h
    );

    // 旧行为：分组后 concat 成 [read, cmd]，与声明的 [cmd, read] 相反
    expect(results.map((r) => r.id)).toEqual(['c1', 'r1']);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('写类工具与读零重叠，且读的可见性由声明顺序确定', async () => {
    const file = join(dir, 's.txt');

    for (let i = 0; i < 5; i++) {
      await writeFile(file, 'BEFORE');
      h.clear();
      const before = await runBatch(
        [
          tc('r', 'read_file', { path: 's.txt' }),
          tc('w', 'write_file', { path: 's.txt', content: 'AFTER' }),
        ],
        { projectPath: dir },
        h
      );
      expect(okOutput(before[0])).toContain('BEFORE');
      expect(overlaps(intervalFor(h, 'r'), intervalFor(h, 'w'))).toBe(false);

      await writeFile(file, 'BEFORE');
      h.clear();
      const after = await runBatch(
        [
          tc('w', 'write_file', { path: 's.txt', content: 'AFTER' }),
          tc('r', 'read_file', { path: 's.txt' }),
        ],
        { projectPath: dir },
        h
      );
      expect(okOutput(after[1])).toContain('AFTER');
      expect(overlaps(intervalFor(h, 'r'), intervalFor(h, 'w'))).toBe(false);
    }
  });

  it('读—写—读切成三波：第二个读确定读到编辑后内容', async () => {
    const file = join(dir, 't.txt');
    await writeFile(file, 'OLD\n');

    const results = await runBatch(
      [
        tc('r1', 'read_file', { path: 't.txt' }),
        tc('e1', 'edit_file', { path: 't.txt', old_string: 'OLD', new_string: 'NEW' }),
        tc('r2', 'read_file', { path: 't.txt' }),
      ],
      { projectPath: dir },
      h
    );

    expect(okOutput(results[0])).toContain('OLD');
    expect(okOutput(results[2])).toContain('NEW');
    expect(overlaps(intervalFor(h, 'r1'), intervalFor(h, 'e1'))).toBe(false);
    expect(overlaps(intervalFor(h, 'e1'), intervalFor(h, 'r2'))).toBe(false);
    expect(overlaps(intervalFor(h, 'r1'), intervalFor(h, 'r2'))).toBe(false);
  });

  it('MCP 工具缺省（无 readOnlyHint）独占一波，声明 true 时与只读工具同波', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');
    const calls = [
      tc('r1', 'read_file', { path: 'a.txt' }),
      tc('m1', 'srv:slow', {}),
    ];
    const makeSpec = (readOnlyHint: boolean): McpToolSpec => ({
      server: 'srv',
      name: 'slow',
      description: 'slow tool',
      inputSchema: {},
      readOnlyHint,
      execute: () => Effect.sleep(Duration.millis(200)).pipe(Effect.as('mcp-ok')),
    });

    h.clear();
    const serial = await runBatch(calls, { projectPath: dir }, h, [makeSpec(false)]);
    expect(serial.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(okOutput(serial[1])).toBe('mcp-ok');
    expect(overlaps(intervalFor(h, 'r1'), intervalFor(h, 'm1'))).toBe(false);

    h.clear();
    const parallel = await runBatch(calls, { projectPath: dir }, h, [makeSpec(true)]);
    expect(parallel.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(overlaps(intervalFor(h, 'r1'), intervalFor(h, 'm1'))).toBe(true);
  });

  it('[read_file, todo_write] 同波并发，控制态写入生效且结果保序', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');

    const results = await runBatch(
      [
        tc('r1', 'read_file', { path: 'a.txt' }),
        tc('t1', 'todo_write', {
          plan: [{ step: 'step one', status: 'pending' }],
        }),
      ],
      { projectPath: dir, sessionId: 'sid-1' },
      h
    );

    // todo_write 只写进程内 Map，不触碰工作树 ⇒ 与只读工具同波
    expect(overlaps(intervalFor(h, 'r1'), intervalFor(h, 't1'))).toBe(true);
    expect(results.map((r) => r.id)).toEqual(['r1', 't1']);
    expect(okOutput(results[1])).toBe('pending=1 in_progress=0 completed=0');
    expect(h.todoStore.get('sid-1')?.[0]?.step).toBe('step one');
  });

  it('[dispatch_agent, write_file] 零重叠，且委派与写入的先后由声明顺序决定', async () => {
    const results = await runBatch(
      [
        tc('d1', 'dispatch_agent', { agent: 'build', prompt: 'go' }),
        tc('w1', 'write_file', { path: 'z.txt', content: 'z' }),
      ],
      { projectPath: dir, sessionId: 'sid-1' },
      h
    );

    expect(okOutput(results[0])).toBe('child-done');
    expect(okOutput(results[1])).toContain('File written');
    const d1 = intervalFor(h, 'd1');
    const w1 = intervalFor(h, 'w1');
    expect(overlaps(d1, w1)).toBe(false);
    expect(d1.end).toBeLessThanOrEqual(w1.start);

    h.clear();
    const reversed = await runBatch(
      [
        tc('w2', 'write_file', { path: 'z2.txt', content: 'z' }),
        tc('d2', 'dispatch_agent', { agent: 'build', prompt: 'go' }),
      ],
      { projectPath: dir, sessionId: 'sid-1' },
      h
    );
    expect(reversed.map((r) => r.id)).toEqual(['w2', 'd2']);
    expect(intervalFor(h, 'w2').end).toBeLessThanOrEqual(intervalFor(h, 'd2').start);
  });

  it('批前已 abort：全部 denied，且没有任何工具启动', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');
    const controller = new AbortController();
    controller.abort();

    const results = await runBatch(
      [
        tc('r1', 'read_file', { path: 'a.txt' }),
        tc('w1', 'write_file', { path: 'w.txt', content: 'x' }),
        tc('r2', 'read_file', { path: 'a.txt' }),
      ],
      { projectPath: dir, signal: controller.signal },
      h
    );

    expect(results.map((r) => r.status)).toEqual(['denied', 'denied', 'denied']);
    expect(h.hookPoints.filter((p) => p === 'tool.execute.before')).toHaveLength(0);
  });

  it('执行中途 abort：后续工具在各自开始前被拒（两条车道判定时机一致）', async () => {
    await writeFile(join(dir, 'a.txt'), 'A');
    const controller = new AbortController();
    // 第一个工具完成后才 abort，故它自身不受影响；后续工具须在开始前发现自己被中止
    h.onAfter = (_name, index) => {
      if (index === 0) controller.abort();
    };

    const results = await runBatch(
      [
        tc('r1', 'read_file', { path: 'a.txt' }),
        tc('w1', 'write_file', { path: 'w.txt', content: 'x' }),
        tc('r2', 'read_file', { path: 'a.txt' }),
      ],
      { projectPath: dir, signal: controller.signal },
      h
    );

    expect(results.map((r) => r.status)).toEqual(['ok', 'denied', 'denied']);
    expect(h.hookPoints.filter((p) => p === 'tool.execute.before')).toHaveLength(1);
  });

  it('11 个内置工具的 concurrencySafe 与分类表逐项一致，且无未覆盖工具', () => {
    const expected: Record<string, boolean> = {
      read_file: true,
      search_code: true,
      search_files: true,
      fetch_url: true,
      web_search: true,
      todo_write: true,
      write_file: false,
      edit_file: false,
      execute_command: false,
      dispatch_agent: false,
      submit_plan: false,
    };

    const { lookup } = createToolCatalog(Object.keys(expected));
    for (const [name, safe] of Object.entries(expected)) {
      expect(lookup(name)?.concurrencySafe, name).toBe(safe);
    }
    expect([...TOOLS_BY_NAME.keys()].sort()).toEqual(Object.keys(expected).sort());

    // 未声明的构造出的 runner 收敛为 false（fail-closed）
    expect(lookup('read_file')?.concurrencySafe).toBe(true);
    expect(lookup('nope')).toBeUndefined();
  });
});
