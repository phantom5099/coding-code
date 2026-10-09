/**
 * @vitest-environment node
 *
 * SSE 契约：帧封套编码 + 「生成器抛出物落成一帧 fatal，而不是断流」。
 *
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type ServerApp } from '../../src/server/index.js';
import { AgentService } from '../../src/agent/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { AgentError } from '../../src/util/error.js';
import type { FrameBody } from '../../src/sink/types.js';
import type { IncomingPart } from '../../src/llm/types.js';

const TEXT_FRAME: FrameBody = { family: 'event', event: { type: 'text_delta', text: 'hello' } };

let cwd: string;
let cancelled: string[] = [];

function makeServer(frames: () => AsyncGenerator<FrameBody, void, unknown>): Promise<ServerApp> {
  const layer = Layer.mergeAll(
    Layer.succeed(AgentService, {
      runTurn: (_input: IncomingPart[], opts: { sessionId?: string }) =>
        Effect.succeed({
          stream: frames(),
          sessionId: opts.sessionId ?? 's1',
        }),
    } as any),
    Layer.succeed(ApprovalWaitService, {
      cancelPendingFor: (sessionId: string) =>
        Effect.sync(() => {
          cancelled.push(sessionId);
          return 0;
        }),
      resolveConfirm: () => Effect.succeed(false),
      waitForConfirm: () => Effect.dieMessage('not implemented'),
    } as any)
  );
  return createServer(ManagedRuntime.make(layer));
}

const send = (app: ServerApp, sessionId = 's1') =>
  app.request(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: [{ type: 'text', text: 'hi' }], cwd, model: 'm' }),
  });

/** 把 SSE body 拆成逐帧的 JSON。 */
const decode = (body: string) =>
  body
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, '').trim()));

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'codingcode-sse-'));
  cancelled = [];
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('SSE /api/sessions/:id/messages', () => {
  it('应答 text/event-stream，帧带封套（sessionId / seq）', async () => {
    const app = await makeServer(async function* () {
      yield TEXT_FRAME;
    });
    const res = await send(app);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = decode(await res.text());
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      sessionId: 's1',
      seq: 1,
      family: 'event',
      event: { type: 'text_delta', text: 'hello' },
    });
  });

  it('生成器抛出物落成一帧 fatal，前序帧照常下发', async () => {
    const app = await makeServer(async function* () {
      yield TEXT_FRAME;
      throw new Error('boom');
    });

    const frames = decode(await (await send(app)).text());
    expect(frames).toHaveLength(2);
    expect(frames[0].family).toBe('event');
    expect(frames[1]).toMatchObject({
      seq: 2,
      family: 'fatal',
      fatal: { message: 'boom', code: 'INTERNAL_ERROR' },
    });
  });

  it('领域错误（AgentError）带出自己的 code —— 不是笼统的 INTERNAL_ERROR', async () => {
    const app = await makeServer(async function* () {
      throw new AgentError('SESSION_CORRUPTED', 'nope');
    });

    const frames = decode(await (await send(app)).text());
    expect(frames[0].fatal.code).toBe('SESSION_CORRUPTED');
  });

  it('流结束时取消该会话的挂起审批', async () => {
    // eslint-disable-next-line require-yield -- 空流正是本用例要覆盖的形状
    const app = await makeServer(async function* () {});
    await (await send(app, 'sess-9')).text();
    expect(cancelled).toEqual(['sess-9']);
  });
});
