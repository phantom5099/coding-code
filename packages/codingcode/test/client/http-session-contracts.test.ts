import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpSessionClient } from '../../src/client/http/sessions.js';
import { createRequestHelpers } from '../../src/client/http/request.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('http session client 与 contracts 对齐', () => {
  it('getSessionHistory 返回 UITurn[]', async () => {
    const turns = [{ id: '1', items: [], status: 'completed' }];
    stubFetch(turns);
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    const result = await client.getSessionHistory({ sessionId: 's1', cwd: '/tmp/p' });

    expect(result).toEqual(turns);
  });

  it('resumeSession 走 resume 端点', async () => {
    stubFetch([{ id: '2', items: [], status: 'completed' }]);
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    const result = await client.resumeSession({ sessionId: 's1', cwd: '/tmp/p' });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('2');
  });

  it('revertCheckpointFiles 解包 server 的 { ok, result } 信封', async () => {
    const codeResult = {
      reverted: true,
      throughTurnId: 3,
      affectedTurns: [3],
      selectedFiles: ['a.ts'],
    };
    stubFetch({ ok: true, result: codeResult });
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    const result = await client.revertCheckpointFiles({
      sessionId: 's1',
      cwd: '/tmp/p',
      files: ['a.ts'],
    });

    expect(result).toEqual(codeResult);
  });

  it('rollbackCodeToTurn 解包 server 的 { ok, result } 信封', async () => {
    const codeResult = {
      reverted: true,
      throughTurnId: 2,
      affectedTurns: [2],
      selectedFiles: [],
    };
    stubFetch({ ok: true, result: codeResult });
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    const result = await client.rollbackCodeToTurn({
      sessionId: 's1',
      cwd: '/tmp/p',
      throughTurnId: 2,
    });

    expect(result).toEqual(codeResult);
  });

  it('getCheckpointDiff 把 turnId 编进路径，缺省用 latest', async () => {
    const calls = stubFetch({ turnId: 0, files: [] });
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    await client.getCheckpointDiff({ sessionId: 's1', cwd: '/tmp/p' });
    expect(calls[0]?.[0]).toContain('/checkpoints/latest/diff');

    await client.getCheckpointDiff({ sessionId: 's1', cwd: '/tmp/p', turnId: 7 });
    expect(calls[1]?.[0]).toContain('/checkpoints/7/diff');
  });

  it('forkSession 把 cwd 与 atTurnId 放进请求体', async () => {
    const calls = stubFetch({ sessionId: 'new', turns: [] });
    const client = createHttpSessionClient(createRequestHelpers('http://localhost:1'));

    await client.forkSession({ sessionId: 's1', cwd: '/tmp/p', atTurnId: 4 });

    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body).toEqual({ cwd: '/tmp/p', atTurnId: 4 });
  });
});
