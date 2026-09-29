import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 契约里声明的 HookPoint 联合成员 */
function declaredPoints(): string[] {
  const src = readFileSync(join(SRC, 'contracts', 'hooks.ts'), 'utf8');
  const union = src.match(/export type HookPoint =([\s\S]*?);/)![1]!;
  return [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** 生产代码里真正 emit 的点 */
function emittedPoints(): Set<string> {
  const found = new Set<string>();
  for (const file of listTsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/hooks\.emit(?:Decision)?\(\s*'([^']+)'/g)) {
      found.add(m[1]!);
    }
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

  it('契约本身非空（防止上面两条正则失配后静默通过）', () => {
    expect(declaredPoints().length).toBeGreaterThanOrEqual(12);
    expect(emittedPoints().size).toBeGreaterThanOrEqual(12);
  });
});
