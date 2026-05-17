import { createServer as createNetServer } from 'net';
import { serve } from '@hono/node-server';
import { HookRegistry } from './hooks/registry';
import { ToolRegistry } from './tools/registry';
import { ToolExecutor } from './tools/executor';
import { getLLMClient } from './llm/factory';
import { DefaultSandbox } from './sandbox/index';
import { readFileTool } from './tools/domains/fs/read';
import { writeFileTool } from './tools/domains/fs/write';
import { listDirTool } from './tools/domains/fs/list';
import { bashTool } from './tools/domains/bash/exec';
import { searchTool } from './tools/domains/search/grep';
import { webFetchTool } from './tools/domains/web/fetch';
import { createServer } from './server/index';
import { loadConfig } from '../../infra/src/config';

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

  // 装配核心依赖
  const hooks = new HookRegistry();
  const tools = new ToolRegistry()
    .register(readFileTool).register(writeFileTool).register(listDirTool)
    .register(bashTool).register(searchTool).register(webFetchTool);
  const sandbox = new DefaultSandbox();
  const executor = new ToolExecutor(tools, hooks, sandbox);
  const llmResult = await getLLMClient();
  if (!llmResult.ok) {
    console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
    process.exit(1);
  }

  const port = await findAvailablePort(basePort);
  const serverUrl = process.env.CODINGCODE_SERVER ?? `http://localhost:${port}`;

  if (tuiOnly) {
    const { runTui } = await import('../../tui/src/index');
    runTui({ serverUrl });
    return;
  }

  const app = createServer({ llm: llmResult.value, executor, hooks });
  serve({ fetch: app.fetch, port });

  if (!serveOnly) {
    const { runTui } = await import('../../tui/src/index');
    runTui({ serverUrl });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
