import { createServer as createNodeServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as HttpServer from '@effect/platform/HttpServer';
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer';
import { Effect, Layer } from 'effect';
import { mkdirSync } from 'fs';
import { corsMiddleware, createHttpApp } from './server/app.js';
import { createAppRuntime } from './layer.js';
import { ensureUserConfig } from './infra/config.js';
import { tempCwd } from './server/cwd.js';
import { AgentError } from './util/error.js';
import { SchedulerService } from './scheduler/port.js';

async function main() {
  ensureUserConfig();
  mkdirSync(tempCwd(), { recursive: true });

  const rt = createAppRuntime();

  const init = await rt.runPromise(
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      scheduler.setRuntime(rt);
      scheduler.initialize();
    }).pipe(
      Effect.match({
        onSuccess: () => ({ type: 'ok' as const }),
        onFailure: (err: unknown) => ({ type: 'err' as const, err }),
      })
    )
  );

  if (init.type === 'err') {
    const err = init.err;
    if (err instanceof AgentError) {
      console.error(`Error [${err.code}]: ${err.message}`);
      process.exit(err.code === 'CONFIG_MISSING' ? 78 : 64);
    }
    console.error('Internal error:', err);
    process.exit(1);
  }

  const httpApp = await Effect.runPromise(createHttpApp());

  const nodeServer = createNodeServer();

  nodeServer.once('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
  nodeServer.on('listening', () => {
    const address = nodeServer.address() as AddressInfo | null;
    if (address && typeof address === 'object') {
      console.log(`CODINGCODE_SERVER_READY:${address.port}`);
    } else {
      console.error('Server is listening on a pipe, not a TCP port');
      process.exit(1);
    }
  });

  const ServerLive = HttpServer.serve(corsMiddleware)(httpApp).pipe(
    Layer.provide(NodeHttpServer.layer(() => nodeServer, { port: 0 }))
  );

  const shutdown = async () => {
    nodeServer.close();
    await rt.dispose();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await rt.runPromise(Layer.launch(ServerLive));
  } catch (err) {
    console.error('Server stopped unexpectedly:', err);
    process.exit(1);
  }
}

main();
