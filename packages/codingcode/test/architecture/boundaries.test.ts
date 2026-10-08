import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 架构边界回归：把 issue 里的 R1–R4 固化成断言，防止再次出现"半倒置"。
// 扫描根是两个包：core 引擎（packages/codingcode/src）与接入层（packages/sdk/src）。
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(HERE, '../../..');
const SRC = resolve(PACKAGES, 'codingcode/src');
const SDK_SRC = resolve(PACKAGES, 'sdk/src');

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

/** R4 的作用域是后端：sdk 是独立的客户端协议层，允许自持同形但同名的类型。 */
const CORE_FILES = listTs(SRC);
const FILES = [...CORE_FILES, ...listTs(SDK_SRC)];

export interface ModuleRef {
  spec: string;
  /** 整条 import 都是类型导入（`import type` 或全部具名 specifier 带 type） */
  typeOnly: boolean;
}

/** 用编译器 API 抽取模块说明符：静态 import / export-from / 动态 import */
function moduleRefsOf(file: string): ModuleRef[] {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const refs: ModuleRef[] = [];
  const push = (spec: string, typeOnly: boolean) => refs.push({ spec, typeOnly });

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      let typeOnly = clause?.isTypeOnly ?? false;
      const bindings = clause?.namedBindings;
      if (!typeOnly && bindings && ts.isNamedImports(bindings)) {
        typeOnly = bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
      }
      push(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      push((node.moduleSpecifier as ts.StringLiteral).text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      push((node.arguments[0] as ts.StringLiteral).text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** 相对说明符 → 仓库内绝对路径（去 .js）；第三方返回 null */
function resolveSpec(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return norm(resolve(dirname(file), spec)).replace(/\.js$/, '');
}

const relSrc = (abs: string) => norm(relative(SRC, abs));
const relSdk = (abs: string) => norm(relative(SDK_SRC, abs));
/** 违规信息用：按所属包给出可读路径 */
const relPkg = (abs: string) =>
  abs.startsWith(norm(SDK_SRC) + '/') ? `sdk/src/${relSdk(abs)}` : `codingcode/src/${relSrc(abs)}`;
const isUtil = (abs: string) => abs.startsWith(norm(join(SRC, 'util')) + '/');

/** 契约文件：每个特性目录的 port.ts（宽 Tag，agent 自持的装配端口也在 agent/port.ts） */
const CONTRACT_FILES = FILES.filter((f) => f.endsWith('/port.ts'));

describe('R1 契约不得 import 实现', () => {
  it('port.ts 跨模块引用只有 util/、同目录，或对方的 types.ts（type-only）', () => {
    const violations: string[] = [];
    for (const file of CONTRACT_FILES) {
      for (const { spec, typeOnly } of moduleRefsOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue; // 第三方库
        if (dirname(target) === dirname(file) || isUtil(target)) continue;
        if (!typeOnly) violations.push(`${relPkg(file)} → ${spec} (runtime import)`);
        else if (!target.endsWith('/types')) violations.push(`${relPkg(file)} → ${spec} (非 types.ts)`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R2 实现不得依赖消费者模块', () => {
  it('agent 自持的装配端口只在 agent/ 内部出现', () => {
    const hits = FILES.filter((f) => /\bToolEnvPort\b/.test(readFileSync(f, 'utf8')))
      .map(relSrc)
      .sort();
    expect(hits).toEqual(['agent/agent.ts', 'agent/port.ts', 'agent/tool-env.ts']);
  });
});

describe('R3 util 零内部依赖', () => {
  it('util/ 不引用 util/ 之外的任何 src 模块', () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => isUtil(f))) {
      for (const { spec } of moduleRefsOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue; // 第三方 / 其他 workspace 包
        if (!isUtil(target)) violations.push(`${relPkg(file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

/** util/ 的准入：只放不指向任何功能模块的通用件 */
const NODE_BUILTINS = new Set([
  'os',
  'path',
  'fs',
  'url',
  'crypto',
  'util',
  'stream',
  'events',
  'buffer',
  'child_process',
  'process',
]);

describe('util/ 准入：只承载通用件', () => {
  it('util/ 的 import 只能是 node 内置与同目录相对路径', () => {
    const violations: string[] = [];
    for (const file of FILES.filter((f) => isUtil(f))) {
      for (const { spec } of moduleRefsOf(file)) {
        if (spec.startsWith('.')) {
          const target = resolveSpec(file, spec)!;
          if (dirname(target) !== dirname(file)) violations.push(`${relPkg(file)} → ${spec}`);
          continue;
        }
        if (!NODE_BUILTINS.has(spec.replace(/^node:/, ''))) {
          violations.push(`${relPkg(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R4 一个概念只允许一处类型定义', () => {
  const CANONICAL: Record<string, string> = {
    ApprovalRequest: 'approval/port.ts',
    ApprovalDecision: 'approval/port.ts',
    TokenUsage: 'llm/types.ts',
    Message: 'llm/types.ts',
    ToolCall: 'llm/types.ts',
    ToolDescription: 'llm/types.ts',
    LLMClient: 'llm/types.ts',
    TodoItem: 'todo/types.ts',
    ProfileName: 'session/types.ts',
    PermissionMode: 'session/types.ts',
    UITurn: 'session/types.ts',
    UITurnItem: 'session/types.ts',
    SessionEvent: 'session/types.ts',
    SessionRef: 'session/types.ts',
    SessionStoreState: 'session/types.ts',
    SessionCreateOptions: 'session/types.ts',
    ToolOutcome: 'sink/types.ts',
    FrameBody: 'sink/types.ts',
    Envelope: 'server/frame-io.ts',
    ToolCatalog: 'tools/types.ts',
    ToolResult: 'tools/types.ts',
    ToolRunner: 'tools/types.ts',
    SelectableModel: 'infra/models.ts',
    HookPoint: 'hooks/types.ts',
    HookDecision: 'hooks/types.ts',
    Skill: 'skills/types.ts',
    McpServerConfig: 'mcp/types.ts',
    McpToolSpec: 'mcp/types.ts',
    Automation: 'scheduler/types.ts',
    AutomationSandbox: 'scheduler/types.ts',
    CreateAutomationInput: 'scheduler/types.ts',
    UpdateAutomationInput: 'scheduler/types.ts',
  };

  it.each(Object.entries(CANONICAL))('%s 只在 %s 声明一次', (name, expected) => {
    const re = new RegExp(
      `^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:interface|type|class)\\s+${name}\\b`,
      'm'
    );
    const owners = CORE_FILES.filter((f) => re.test(readFileSync(f, 'utf8')))
      .map(relSrc)
      .sort();
    expect(owners).toEqual([norm(expected)]);
  });
});

describe('相对 import 必须可解析', () => {
  it('每条相对 import 都能在仓库内找到落点（覆盖 layer.ts 等测试不加载的模块）', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      for (const { spec } of moduleRefsOf(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue;
        const ok = ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((ext) =>
          existsSync(target + ext)
        );
        if (!ok) missing.push(`${relPkg(file)} → ${spec}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
