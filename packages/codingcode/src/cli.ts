import { Effect } from 'effect';
import { serve } from '@hono/node-server';
import { LLMFactoryService } from './llm/factory.js';
import { createServer } from './server/index.js';
import { createAppRuntime } from './layer.js';
import { loadConfig, ensureUserConfig } from '../../infra/src/config.js';
import { WorkspaceService, parseWorkspaceArgs } from './core/workspace.js';
import { findAvailablePort } from './server/port-discovery.js';
import { AgentError } from './core/error.js';
import { SchedulerService } from './scheduler/service.js';

async function main() {
  const installRoot = process.cwd();
  const { workspaceCwd, args } = parseWorkspaceArgs(process.argv.slice(2));
  ensureUserConfig();
  const config = loadConfig();

  const serveOnly = args.includes('serve');
  const tuiOnly = args.includes('tui');
  const basePort = config.server.port;

  const rt = createAppRuntime();

  const program = Effect.gen(function* () {
    const ws = yield* WorkspaceService;
    ws.init({ processRoot: installRoot, workspaceCwd });
    if (workspaceCwd) {
      console.log(`Workspace: ${ws.getWorkspaceCwd()}`);
    }

    const port = yield* Effect.tryPromise(() => findAvailablePort(basePort));
    const llmFactory = yield* LLMFactoryService;

    // Initialize scheduler with the shared runtime
    const scheduler = yield* SchedulerService;
    scheduler.setRuntime(rt);
    scheduler.initialize();

    if (tuiOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      const llm = yield* llmFactory.getLLMClient();
      runTui({ llm, rt });
      return;
    }

    const app = yield* Effect.tryPromise(() => createServer(rt));
    serve({ fetch: app.fetch, port });
    console.log(`CODINGCODE_SERVER_READY:${port}`);

    if (!serveOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      const llm = yield* llmFactory.getLLMClient();
      runTui({ llm, rt });
    }
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
