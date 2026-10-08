import { Effect } from 'effect';
import { mkdirSync } from 'fs';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createServer } from './server/index.js';
import { createAppRuntime } from './layer.js';
import { ensureUserConfig } from './infra/config.js';
import { tempCwd } from './server/cwd.js';
import { AgentError } from './core/error.js';
import { SchedulerService } from './scheduler/port.js';

function listen(app: Hono): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: 0 });
    server.on('error', reject);
    server.on('listening', () => {
      server.removeAllListeners('error');
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
      } else {
        reject(new Error('Server is listening on a pipe, not a TCP port'));
      }
    });
  });
}

async function main() {
  ensureUserConfig();
  mkdirSync(tempCwd(), { recursive: true });

  const rt = createAppRuntime();

  const program = Effect.gen(function* () {
    // Initialize scheduler with the shared runtime
    const scheduler = yield* SchedulerService;
    scheduler.setRuntime(rt);
    scheduler.initialize();

    const app = yield* Effect.tryPromise(() => createServer(rt));
    const port = yield* Effect.tryPromise(() => listen(app));
    console.log(`CODINGCODE_SERVER_READY:${port}`);
  });

  const result = await rt.runPromise(
    program.pipe(
      Effect.match({
        onSuccess: () => ({ type: 'ok' as const }),
        onFailure: (err: unknown) => ({ type: 'err' as const, err }),
      })
    )
  );

  if (result.type === 'err') {
    const err = result.err;
    if (err instanceof AgentError) {
      console.error(`Error [${err.code}]: ${err.message}`);
      process.exit(err.code === 'CONFIG_MISSING' ? 78 : 64);
    }
    console.error('Internal error:', err);
    process.exit(1);
  }
}

main();
