import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { computePaths } from '../../src/session/paths.js';
import { transcriptPathFor } from '../../src/context/context.js';
import type { SessionRef } from '../../src/contracts/session.js';

/**
 * context 与 session 各自「用 core/path 的纯函数格式化入参、再用 contracts 常量拼接」。
 * 两处实现必须产出同一个字符串，否则 context 会去读一个不存在的文件。
 * 这条断言就是防漂移的护栏。
 */
describe('会话转录路径：context 与 session 各自拼接的结果必须一致', () => {
  const cases: Array<{ cwd: string; parentSessionId?: string }> = [
    { cwd: 'c:/Users/me/proj' },
    { cwd: '/home/me/proj' },
    { cwd: 'C:\\Users\\me\\my proj' },
    { cwd: '/home/me/proj', parentSessionId: 'parent-fixed-id' },
  ];

  for (const { cwd, parentSessionId } of cases) {
    it(`cwd=${cwd} parent=${parentSessionId ?? '(none)'}`, () => {
      const sessionId = randomUUID();
      const ref: SessionRef = { cwd, sessionId, parentSessionId, currentTurnId: 0 };

      expect(transcriptPathFor(ref)).toBe(
        computePaths(cwd, sessionId, parentSessionId).transcriptPath
      );
    });
  }
});
