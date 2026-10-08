import { describe, it } from 'vitest';
import type { ToolExecCall, ToolExecCtx, ToolExecOpts } from '../../src/tools/types.js';

// 本文件只做编译期类型约束（tsc 执行 @ts-expect-error 校验），不含运行时断言。

/** ToolExecCtx 的键若有一个没进 ToolExecCall，投影就会漏字段 */
type UnprojectedCtxKey = Exclude<keyof ToolExecCtx, keyof ToolExecCall>;
type CtxFullyProjected = [UnprojectedCtxKey] extends [never] ? true : false;

describe('工具执行参数的形状收口', () => {
  it('ToolExecOpts 由 ToolExecCtx 派生：换掉 sessionId、加上 turnId', () => {
    const opts: ToolExecOpts = {
      turnId: 3,
      projectPath: '/p',
      signal: new AbortController().signal,
      activeProfile: 'plan',
      model: 'm',
    };
    void opts;

    // 派生关系：ToolExecCtx 改字段而 ToolExecOpts 没跟上时，这里编译不过
    const asCtx: Omit<ToolExecCtx, 'sessionId'> = opts;
    void asCtx;
  });

  it('ToolExecCtx 的每个字段都进了投影链（ToolExecCall）', () => {
    // 若哪天把 ToolExecOpts/ToolExecCall 改回手写接口并漏了字段，这里会变成 false
    const fullyProjected: CtxFullyProjected = true;
    void fullyProjected;
  });

  it('sessionId 不进 ToolExecOpts —— 它是 executeBatch 的位置参数', () => {
    // @ts-expect-error sessionId 由 executeBatch 位置参数传，不放进 opts
    const bad: ToolExecOpts = { model: 'm', sessionId: 's-1' };
    void bad;
  });

  it('编排私有字段不外泄到工具可见的 ctx', () => {
    // @ts-expect-error turnId 只进 hook payload，不属于 ToolExecCtx
    const badTurn: ToolExecCtx = { model: 'm', turnId: 1 };
    void badTurn;
    // @ts-expect-error callId 只进 hook payload，不属于 ToolExecCtx
    const badCall: ToolExecCtx = { model: 'm', callId: 'c-1' };
    void badCall;
  });

  it('ToolExecCall = ToolExecOpts + 批次级 sessionId / callId', () => {
    const call: ToolExecCall = { model: 'm', turnId: 1, sessionId: 's', callId: 'c' };
    void call;
  });
});
