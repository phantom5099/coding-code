import { Effect } from 'effect';
import { mkdirSync } from 'fs';
import { serve } from '@hono/node-server';
import { createServer } from './server/index.js';
import { createAppRuntime } from './layer.js';
import { loadConfig, ensureUserConfig } from './infra/config.js';
import { tempCwd } from './server/cwd.js';
import { findAvailablePort } from './server/port-discovery.js';
import { AgentError } from './core/error.js';
import { SchedulerService } from './scheduler/port.js';

async function main() {
  ensureUserConfig();
  mkdirSync(tempCwd(), { recursive: true });
  const config = loadConfig();

  const basePort = config.server.port;

  const rt = createAppRuntime();

  const program = Effect.gen(function* () {
    const port = yield* Effect.tryPromise(() => findAvailablePort(basePort));

    // Initialize scheduler with the shared runtime
    const scheduler = yield* SchedulerService;
    scheduler.setRuntime(rt);
    scheduler.initialize();

    const app = yield* Effect.tryPromise(() => createServer(rt));
    serve({ fetch: app.fetch, port });
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
