import { Effect } from 'effect';
import { serve } from '@hono/node-server';
import { getLLMClient } from './llm/factory.js';
import { createServer } from './server/index.js';
import { AppLayer } from './layer.js';
import { loadConfig, ensureUserConfig } from '../../infra/src/config.js';
import { getWorkspaceCwd, initWorkspace, parseWorkspaceArgs } from './core/workspace.js';
import { findAvailablePort } from './server/port-discovery.js';
import { AgentError } from './core/error.js';

async function main() {
  const installRoot = process.cwd();
  const { workspaceCwd, args } = parseWorkspaceArgs(process.argv.slice(2));
  ensureUserConfig();
  const config = loadConfig();
  initWorkspace({ processRoot: installRoot, workspaceCwd, config });
  if (workspaceCwd) {
    console.log(`Workspace: ${getWorkspaceCwd()}`);
  }
  const serveOnly = args.includes('serve');
  const tuiOnly = args.includes('tui');
  const basePort = config.server.port;

  const program = Effect.gen(function* () {
    const port = yield* Effect.tryPromise(() => findAvailablePort(basePort));

    if (tuiOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      const llmResult = yield* Effect.tryPromise(() => getLLMClient());
      if (!llmResult.ok) {
        console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
        process.exit(1);
      }
      runTui({ llm: llmResult.value });
      return;
    }

    const app = yield* Effect.tryPromise(() => createServer());
    serve({ fetch: app.fetch, port });

    if (!serveOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      const llmResult = yield* Effect.tryPromise(() => getLLMClient());
      if (!llmResult.ok) {
        console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
        process.exit(1);
      }
      runTui({ llm: llmResult.value });
    }
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.match({
        onSuccess: () => ({ type: 'ok' as const }),
        onFailure: (err: unknown) => ({ type: 'err' as const, err }),
      }),
      Effect.provide(AppLayer)
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
