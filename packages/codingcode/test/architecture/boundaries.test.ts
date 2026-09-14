import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 架构边界回归：把 issue 里的 R1–R4 固化成断言，防止再次出现"半倒置"。
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');

const norm = (p: string) => p.replace(/\\/g, '/');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith('.ts')) out.push(norm(p));
  }
  return out;
}

const FILES = listTs(SRC);

/** 抽取文件里的模块说明符（静态 import 与动态 import） */
function specifiersOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

/** 相对说明符 → 仓库内绝对路径（去 .js）；第三方返回 null */
function resolveSpec(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return norm(resolve(dirname(file), spec)).replace(/\.js$/, '');
}

const relSrc = (abs: string) => norm(relative(SRC, abs));
const isCore = (abs: string) => abs.startsWith(norm(join(SRC, 'core')) + '/');
const isContracts = (abs: string) => abs.startsWith(norm(join(SRC, 'contracts')) + '/');

/** 契约文件：每个特性目录的 port.ts（宽 Tag） + agent 的窄端口集合 */
const CONTRACT_FILES = FILES.filter((f) => f.endsWith('/port.ts')).concat([norm(join(SRC, 'agent/deps.ts'))]);

describe('R1 契约不得 import 实现', () => {
  it('所有 port.ts 与 agent/deps.ts 的跨模块引用只有 core/、contracts/ 与同目录类型', () => {
    const violations: string[] = [];
    for (const file of CONTRACT_FILES) {
      for (const spec of specifiersOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue; // 第三方库
        const sameDir = dirname(target) === dirname(file);
        if (!isCore(target) && !isContracts(target) && !sameDir) {
          violations.push(`${relSrc(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R2 实现不得依赖消费者模块', () => {
  it('窄端口契约只对消费者 agent/agent.ts 与组合根 layer.ts 可见', () => {
    const depSpec = norm(join(SRC, 'agent/deps'));
    const importers = FILES.filter((f) =>
      specifiersOf(f).some((s) => resolveSpec(f, s) === depSpec)
    ).map(relSrc).sort();
    expect(importers).toEqual([
      'agent/agent.ts',
      'agent/tool-catalog.ts',
      'agent/tool-env.ts',
      'layer.ts',
    ]);
  });
});

describe('R3 core 零内部依赖', () => {
  it('core/ 不引用 core/ 之外的任何 src 模块', () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => isCore(f))) {
      for (const spec of specifiersOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue; // 第三方 / 其他 workspace 包
        if (!isCore(target)) violations.push(`${relSrc(file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

/** core/ 的准入：只放不指向任何功能模块的通用件 */
const NODE_BUILTINS = new Set([
  'os', 'path', 'fs', 'url', 'crypto', 'util', 'stream', 'events', 'buffer', 'child_process', 'process',
]);

describe('core/ 准入：只承载通用件', () => {
  it('core/ 的 import 只能是 node 内置与同目录相对路径', () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => isCore(f))) {
      for (const spec of specifiersOf(file)) {
        if (spec.startsWith('.')) {
          const target = resolveSpec(file, spec)!;
          if (dirname(target) !== dirname(file)) violations.push(`${relSrc(file)} → ${spec}`);
          continue;
        }
        if (!NODE_BUILTINS.has(spec.replace(/^node:/, ''))) {
          violations.push(`${relSrc(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('contracts/ 准入：不得依赖领域实现', () => {
  it('contracts/ 的文件只引用 core/、同目录与第三方', () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => isContracts(f))) {
      for (const spec of specifiersOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue;
        const sameDir = dirname(target) === dirname(file);
        if (!isCore(target) && !sameDir) violations.push(`${relSrc(file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R4 一个概念只允许一处类型定义', () => {
  const CANONICAL: Record<string, string> = {
    TokenUsage: 'contracts/types.ts',
    TodoItem: 'contracts/types.ts',
    ProfileName: 'contracts/types.ts',
    UITurn: 'contracts/session.ts',
    UITurnItem: 'contracts/session.ts',
    SessionEvent: 'contracts/session.ts',
    SessionStoreState: 'contracts/session.ts',
    SessionCreateOptions: 'contracts/session.ts',
    ToolOutcome: 'contracts/frame.ts',
    ToolResult: 'contracts/tool.ts',
    ToolRunner: 'contracts/tool.ts',
    ToolLookup: 'contracts/tool.ts',
    LLMClient: 'contracts/provider.ts',
    SelectableModel: 'contracts/provider.ts',
    PermissionMode: 'contracts/permission.ts',
    ApprovalDecision: 'contracts/permission.ts',
    ApprovalRequest: 'agent/deps.ts',
    HookPoint: 'contracts/hooks.ts',
    HookDecision: 'contracts/hooks.ts',
    Skill: 'contracts/skill.ts',
    McpServerConfig: 'contracts/mcp.ts',
    McpStatus: 'contracts/mcp.ts',
  };

  it.each(Object.entries(CANONICAL))('%s 只在 %s 声明一次', (name, expected) => {
    const re = new RegExp(
      `^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:interface|type|class)\\s+${name}\\b`,
      'm'
    );
    const owners = FILES.filter((f) => re.test(readFileSync(f, 'utf8'))).map(relSrc).sort();
    expect(owners).toEqual([norm(expected)]);
  });
});

describe('相对 import 必须可解析', () => {
  it('每条相对 import 都能在仓库内找到落点（覆盖 layer.ts 等测试不加载的模块）', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      for (const spec of specifiersOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue;
        const ok = ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((ext) =>
          existsSync(target + ext)
        );
        if (!ok) missing.push(`${relSrc(file)} → ${spec}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
