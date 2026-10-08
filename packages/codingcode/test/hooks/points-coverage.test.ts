import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import ts from 'typescript';

const SRC = resolve(__dirname, '../../src');
const HOOK_END_TYPES = join(SRC, 'hooks', 'types.ts');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

/** hooks/types.ts 里声明的 HookPoint 联合成员 */
function declaredPoints(): string[] {
  const sf = parse(HOOK_END_TYPES);
  for (const stmt of sf.statements) {
    if (
      ts.isTypeAliasDeclaration(stmt) &&
      stmt.name.text === 'HookPoint' &&
      ts.isUnionTypeNode(stmt.type)
    ) {
      return stmt.type.types.flatMap((t) =>
        ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []
      );
    }
  }
  return [];
}

/** 生产代码里真正 emit 的点：`hooks.emit('x')` / `hooks.emitDecision('x')` */
function emittedPoints(): Set<string> {
  const found = new Set<string>();
  for (const file of listTsFiles(SRC)) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'hooks' &&
          (callee.name.text === 'emit' || callee.name.text === 'emitDecision')
        ) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) found.add(arg.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return found;
}

describe('HookPoint 契约与触发点一致', () => {
  it('每个声明的钩子点都有真实触发点（不存在「定义了但从不 emit」的点）', () => {
    const emitted = emittedPoints();
    const missing = declaredPoints().filter((p) => !emitted.has(p));
    expect(missing).toEqual([]);
  });

  it('不存在 emit 了但没写进契约的点', () => {
    const declared = new Set(declaredPoints());
    const undeclared = [...emittedPoints()].filter((p) => !declared.has(p));
    expect(undeclared).toEqual([]);
  });

  it('契约本身非空（防止上面两条解析失配后静默通过）', () => {
    expect(declaredPoints().length).toBeGreaterThanOrEqual(12);
    expect(emittedPoints().size).toBeGreaterThanOrEqual(12);
  });
});
