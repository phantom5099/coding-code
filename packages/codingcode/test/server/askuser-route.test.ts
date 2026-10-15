import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Fiber, ManagedRuntime } from 'effect';
import { createServer } from '../../src/server/index.js';
import { AskWaitService, type AskAnswer } from '../../src/askuser/port.js';
import { AskWaitLayer } from '../../src/askuser/wait.js';

// askuser 路由只在请求期依赖 AskWaitService（见 sse.test.ts：createServer 不在装配期索取全部服务）
const rt = ManagedRuntime.make(AskWaitLayer);

beforeEach(async () => {
  // 清掉上一例可能残留的待答条目，保证测试隔离
  const svc = await rt.runPromise(AskWaitService);
  await rt.runPromise(svc.cancelPendingFor('sess-1'));
});

async function postAsk(sessionId: string, id: string, body: unknown): Promise<{ ok: boolean }> {
  const app = await createServer(rt);
  const res = await app.request(`/api/sessions/${sessionId}/askuser/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: boolean };
}

/** 注册一个等待者并返回读取其收到答案的 Effect；runFork 同步执行到 Deferred.await，返回即已注册 */
function waitRegistered(svc: Awaited<ReturnType<typeof getService>>, id: string, sessionId: string) {
  const fiber = rt.runFork(svc.waitForAsk(id, sessionId));
  return Effect.map(Fiber.join(fiber), (answer) => answer);
}

const getService = () => rt.runPromise(AskWaitService);

describe('POST /api/sessions/:sessionId/askuser/:id', () => {
  it('合法 body {options:[A], custom} → answered 且 custom 去空白', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-1', 'sess-1');
    const res = await postAsk('sess-1', 'tc-1', { options: ['A'], custom: '  备注  ' });
    expect(res).toEqual({ ok: true });

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'answered', options: ['A'], custom: '备注' });
  });

  it('仅 custom → answered(options 为空数组)', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-2', 'sess-1');
    await postAsk('sess-1', 'tc-2', { custom: '其他颜色' });

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'answered', options: [], custom: '其他颜色' });
  });

  it('多字母选项保留顺序 {options:[B,A]}', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-3', 'sess-1');
    await postAsk('sess-1', 'tc-3', { options: ['B', 'A'] });

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'answered', options: ['B', 'A'], custom: null });
  });

  it('空 body {} → fail-closed 为 no_answer', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-4', 'sess-1');
    await postAsk('sess-1', 'tc-4', {});

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'no_answer' });
  });

  it('非法选项被过滤（非字符串 / 越界字母）+ 空白 custom → no_answer', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-5', 'sess-1');
    await postAsk('sess-1', 'tc-5', { options: ['a', 42, 'Z', null], custom: '   ' });

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'no_answer' });
  });

  it('未知 id → ok:false', async () => {
    const res = await postAsk('sess-1', 'no-such-id', { options: ['A'] });
    expect(res).toEqual({ ok: false });
  });

  it('跨会话 resolve 被拒绝 → ok:false 且原等待者不受污染', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-6', 'sess-1');

    const res = await postAsk('sess-other', 'tc-6', { options: ['A'] });
    expect(res).toEqual({ ok: false });

    // 原等待者仍未被解决——用正确会话补一发 resolve 验证条目完好
    const ok = await rt.runPromise(
      svc.resolveAsk('tc-6', 'sess-1', { status: 'answered', options: ['C'], custom: null })
    );
    expect(ok).toBe(true);
    const answer: AskAnswer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'answered', options: ['C'], custom: null });
  });

  it('malformed JSON body → fail-closed no_answer（回合不被毒死）', async () => {
    const svc = await getService();
    const waiter = waitRegistered(svc, 'tc-7', 'sess-1');
    const app = await createServer(rt);
    const res = await app.request('/api/sessions/sess-1/askuser/tc-7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    });
    expect(res.status).toBe(200);

    const answer = await rt.runPromise(waiter);
    expect(answer).toEqual({ status: 'no_answer' });
  });
});
