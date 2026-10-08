import * as HttpApp from '@effect/platform/HttpApp';
import type { ManagedRuntime } from 'effect';
import { Effect } from 'effect';
import { corsMiddleware, createHttpApp } from './app.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export interface ServerApp {
  request(input: string | Request, init?: RequestInit): Promise<Response>;
}

export async function createServer(rt: ManagedRt): Promise<ServerApp> {
  const app = await Effect.runPromise(createHttpApp());
  const runtime = await rt.runtime();
  const handler = HttpApp.toWebHandlerRuntime(runtime)(app, corsMiddleware);

  return {
    request: (input, init) =>
      handler(
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input
      ),
  };
}
