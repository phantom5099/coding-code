import * as HttpRouter from '@effect/platform/HttpRouter';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import { Effect, Stream } from 'effect';
import { AgentError } from '../util/error.js';
import { ApprovalWaitService } from '../approval/wait-port.js';
import type { FrameBody } from '../sink/types.js';
import { createFrameAssembler, encodeFrame } from './frame-io.js';
import { errorCodeOf, isAppError, type AppError } from './http-error.js';

export type Handler<E = AppError> = HttpRouter.Route.Handler<E, any>;

export type Router = HttpRouter.HttpRouter<any, any>;

export const json = (body: unknown, status?: number): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.unsafeJson(body, status === undefined ? undefined : { status });

export const query: Effect.Effect<
  Readonly<Record<string, string>>,
  never,
  HttpServerRequest.ParsedSearchParams
> = Effect.map(HttpServerRequest.ParsedSearchParams, (params) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return out;
});

/** 路径参数（`/api/sessions/:id` 里的 id）。 */
export const pathParams: Effect.Effect<
  Readonly<Record<string, string | undefined>>,
  never,
  HttpRouter.RouteContext
> = HttpRouter.params;

/** 平台请求 → web Request。给需要原生 signal / web API 的路由用；转换失败属于框架级缺陷。 */
export const webRequest: Effect.Effect<Request, never, HttpServerRequest.HttpServerRequest> =
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    HttpServerRequest.toWeb(request).pipe(Effect.orDie)
  );

/** body 不是合法 JSON = 请求体问题，落 400，而不是让 JSON.parse 抛成 500。 */
const asAppError = (cause: unknown): AgentError =>
  new AgentError(
    'CONFIG_INVALID',
    `Malformed JSON body: ${cause instanceof Error ? cause.message : String(cause)}`
  );

function parseJson<T>(source: Effect.Effect<unknown, unknown>): Effect.Effect<T, AgentError> {
  return source.pipe(Effect.mapError(asAppError)) as Effect.Effect<T, AgentError>;
}

/** 读 JSON body（空 body / 坏 JSON → 400 CONFIG_INVALID）。 */
export const readJson = <T>(): Effect.Effect<T, AgentError, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* parseJson<T>(request.json);
  });

/** 读 JSON body，读不到就给 `{}`（对齐旧代码的 `c.req.json().catch(() => ({}))`）。 */
export const readJsonOrEmpty = <T>(): Effect.Effect<T, never, HttpServerRequest.HttpServerRequest> =>
  readJson<T>().pipe(Effect.catchAll(() => Effect.succeed({} as T)));

/** 从已经拿到的 web Request 上读 JSON body。 */
export const readJsonFrom = <T>(web: Request): Effect.Effect<T, AgentError> =>
  parseJson<T>(
    Effect.tryPromise({
      try: () => web.json() as Promise<unknown>,
      catch: (cause) => cause,
    })
  );

/**
 * SSE 响应：把领域帧流编码成 `data: <frame>\n\n`，流结束（或被打断）时取消该会话的挂起审批。
 *
 * 旧实现手写 ReadableStream + `Effect.runSync` 收尾；这里交给 Stream，收尾走 finalizer，
 * 客户端中途断开也会执行。
 */
export const sseResponse = (
  frames: Stream.Stream<FrameBody, never>,
  opts: { sessionId: string; onDone?: () => void }
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, ApprovalWaitService> =>
  Effect.gen(function* () {
    const wait = yield* ApprovalWaitService;
    const assembler = createFrameAssembler({ sessionId: opts.sessionId });
    const encoder = new TextEncoder();
    const body = frames.pipe(
      Stream.map((frame) => encoder.encode(`data: ${encodeFrame(assembler.stamp(frame))}\n\n`)),
      Stream.ensuring(
        Effect.sync(() => {
          Effect.runSync(wait.cancelPendingFor(opts.sessionId));
          opts.onDone?.();
        })
      )
    );
    return HttpServerResponse.stream(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

/**
 * 把 AsyncGenerator 的抛出物转成**一帧 fatal**（不中断流）——对齐旧 SSE 行为：
 * 回合失败是「最后一条消息」，不是连接级错误。
 */
export const frameStream = (gen: AsyncGenerator<FrameBody, void, unknown>): Stream.Stream<FrameBody> =>
  Stream.fromAsyncIterable(gen, (cause) => cause).pipe(
    Stream.catchAll((cause) =>
      Stream.make({
        family: 'fatal' as const,
        fatal: {
          message: cause instanceof Error ? cause.message : String(cause),
          code: isAppError(cause) ? errorCodeOf(cause) : 'INTERNAL_ERROR',
        },
      })
    )
  );
