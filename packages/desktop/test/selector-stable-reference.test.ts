/**
 * @vitest-environment jsdom
 *
 * 回归：React「Maximum update depth exceeded」自激更新循环。
 *
 * 根因：zustand selector 里出现 `?? []` / `: []` 这类字面量 fallback 时，
 * 每次 render 都会返回一个【新数组引用】。zustand 默认用 Object.is 比较
 * selector 的返回值，于是每次 render 都判定「值变了」→ 触发订阅更新 →
 * 又 render → 又新引用 …… 形成无限循环。
 *
 * 修法：用 `useShallow` 包住 selector，按【元素引用】浅比较。
 * 本文件从两个层面锁住：
 *   1. 源码层面 —— 相关 selector 确实被 useShallow 包裹（防回退）；
 *   2. 语义层面 —— 空数组 fallback 在浅比较下判为「相等」，不再触发更新。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('zustand selector 自激更新循环回归', () => {
  describe('源码层面：文本量 fallback 的 selector 必须被 useShallow 包裹', () => {
    const cases: Array<{ file: string; selectorMarker: RegExp; label: string }> = [
      {
        file: 'agent/AgentWorkspace.tsx',
        selectorMarker: /queuedInputsByThreadId\[s\.currentThreadId\]\s*\?\?\s*\[\]/,
        label: 'AgentWorkspace 的 queuedInputs',
      },
      {
        file: 'agent/MessageStream.tsx',
        selectorMarker: /s\.threads\[threadId\]\?\.turns\s*\?\?\s*\[\]/,
        label: 'MessageStream 的 turns',
      },
    ];

    for (const { file, selectorMarker, label } of cases) {
      it(`${label} 使用 ?? [] 且已被 useShallow 包裹`, () => {
        const src = sourceOf(file);
        // 前提：确实是「字面量 fallback」型 selector（否则本用例失去意义）
        expect(src).toMatch(selectorMarker);
        // 约束：该 selector 被 useShallow 包裹
        expect(src).toMatch(/useShallow\(\s*\(s\)\s*=>/);
        // 约束：从 zustand/react/shallow 引入
        expect(src).toMatch(/from\s+['"]zustand\/react\/shallow['"]/);
      });
    }
  });

  describe('语义层面：浅比较让「内容相同的空数组」判等', () => {
    // 复刻 zustand 默认比较（Object.is）
    const defaultEquals = Object.is;
    // 复刻 useShallow 的比较语义：逐元素 ===
    function shallowEqualsArray(a: readonly unknown[], b: readonly unknown[]): boolean {
      if (a === b) return true;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    it('两个独立的 [] 字面量在 Object.is 下【不相等】—— 这正是循环的起因', () => {
      expect(defaultEquals([], [])).toBe(false);
    });

    it('两个独立的 [] 字面量在浅比较下【相等】—— 不再触发更新', () => {
      expect(shallowEqualsArray([], [])).toBe(true);
    });

    it('内容相同但引用不同的元素数组，浅比较判等', () => {
      const item = { id: 'q1', status: 'queued' };
      const a = [item];
      const b = [item]; // 不同数组，同一元素引用
      expect(defaultEquals(a, b)).toBe(false);
      expect(shallowEqualsArray(a, b)).toBe(true);
    });

    it('元素发生真实增删时，浅比较仍能判出不相等（不会漏更新）', () => {
      const item = { id: 'q1', status: 'queued' };
      expect(shallowEqualsArray([item], [])).toBe(false);
      expect(shallowEqualsArray([], [item])).toBe(false);
    });
  });
});
