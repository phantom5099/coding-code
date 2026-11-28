import { describe, it } from 'vitest';
import type { ToolBatchContext, ToolExecCtx } from '@codingcode/tool';

// 本文件只做编译期类型约束（tsc 执行 @ts-expect-error 校验），不含运行时断言。

describe('工具执行参数的形状收口', () => {
  it('ToolBatchContext 封装批次级上下文与 SessionRef', () => {
    const batch: ToolBatchContext = {
      session: { cwd: '/p', sessionId: 's-1', currentTurnId: 3 },
      signal: new AbortController().signal,
      model: 'm',
    };
    void batch;
  });

  it('sessionId / projectPath 不作为裸字段挂在 ToolBatchContext 上（统一归属 session）', () => {
    const badSid: ToolBatchContext = {
      session: { cwd: '/p', sessionId: 's-1', currentTurnId: 1 },
      model: 'm',
      // @ts-expect-error sessionId 归属 session: SessionRef，不作为平铺字段
      sessionId: 's-1',
    };
    void badSid;

    const badPath: ToolBatchContext = {
      session: { cwd: '/p', sessionId: 's-1', currentTurnId: 1 },
      model: 'm',
      // @ts-expect-error projectPath 归属 session.cwd，不作为平铺字段
      projectPath: '/p',
    };
    void badPath;
  });

  it('callId 不进 ToolBatchContext —— 它由执行器按 tc.id 注入', () => {
    const bad: ToolBatchContext = {
      session: { cwd: '/p', sessionId: 's-1', currentTurnId: 1 },
      model: 'm',
      // @ts-expect-error callId 按单次调用注入，不放进批次上下文
      callId: 'c-1',
    };
    void bad;
  });

  it('编排私有字段不外泄到工具可见的 ctx', () => {
    // @ts-expect-error turnId 只进 hook payload，不属于 ToolExecCtx
    const badTurn: ToolExecCtx = { model: 'm', turnId: 1 };
    void badTurn;

    // @ts-expect-error currentTurnId 属于 SessionRef，不外泄到 ToolExecCtx
    const badCurrentTurn: ToolExecCtx = { model: 'm', currentTurnId: 1 };
    void badCurrentTurn;
  });

  it('callId 随 ctx 透传给工具（ask_user 等待键）', () => {
    const ctx: ToolExecCtx = { model: 'm', callId: 'c-1' };
    void ctx;
  });
});
