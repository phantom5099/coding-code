import { Effect } from 'effect';
import { createServer as createNetServer } from 'net';
import { serve } from '@hono/node-server';
import { ToolService } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { HookService } from './hooks/registry.js';
import { McpService } from './mcp/index.js';
import { SkillService } from './skills/index.js';
import { getLLMClient } from './llm/factory.js';
import { DefaultSandbox } from './sandbox/index.js';
import { readFileTool } from './tools/domains/fs/read.js';
import { writeFileTool } from './tools/domains/fs/write.js';
import { listDirTool } from './tools/domains/fs/list.js';
import { bashTool } from './tools/domains/bash/exec.js';
import { searchTool } from './tools/domains/search/grep.js';
import { webFetchTool } from './tools/domains/web/fetch.js';
import { createServer } from './server/index.js';
import { AppLayer } from './layer.js';
import { loadConfig } from '../../infra/src/config.js';

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        server.close();
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : startPort;
      server.close();
      resolve(port);
    });
    server.listen(startPort);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const serveOnly = args.includes('serve');
  const tuiOnly = args.includes('tui');
  const config = loadConfig();
  const basePort = config.server.port;

  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const skill = yield* SkillService;

    // Register built-in tools
    yield* tools.register(readFileTool);
    yield* tools.register(writeFileTool);
    yield* tools.register(listDirTool);
    yield* tools.register(bashTool);
    yield* tools.register(searchTool);
    yield* tools.register(webFetchTool);

    // Connect MCP servers (auto-registers tools to ToolService)
    yield* mcp.connectAll(process.cwd());

    // Load skills
    yield* skill.loadAll(process.cwd());

    // Initialize LLM
    const llmResult = yield* Effect.tryPromise(() => getLLMClient());
    if (!llmResult.ok) {
      console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
      process.exit(1);
    }

    // Find available port
    const port = yield* Effect.tryPromise(() => findAvailablePort(basePort));
    const serverUrl = process.env.CODINGCODE_SERVER ?? `http://localhost:${port}`;

    if (tuiOnly) {
      const { runTui } = yield* Effect.tryPromise(() => import('../../tui/src/index.js'));
      runTui({ serverUrl });
      return;
    }

    const sandbox = new DefaultSandbox();
    const executor = new ToolExecutor(tools, hooks, sandbox);
    const app = createServer({ llm: llmResult.value, executor, hooks });
    serve({ fetch: app.fetch, port });

    if (!serveOnly) {
      const { runTui } = yield* Effect.tryPromise(() => import('../../tui/src/index.js'));
      runTui({ serverUrl });
    }
  });

  await Effect.runPromise(program.pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
