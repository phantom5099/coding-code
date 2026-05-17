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

async function main() {
  const args = process.argv.slice(2);
  const serveOnly = args.includes('serve');
  const tuiOnly = args.includes('tui');
  const port = parseInt(process.env.PORT ?? '3000', 10);

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

  if (tuiOnly) {
    const { runTui } = await import('../../tui/src/index');
    runTui({ serverUrl: process.env.CODINGCODE_SERVER ?? `http://localhost:${port}` });
    return;
  }

  const app = createServer();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Server: http://localhost:${info.port}`);
  });

  if (!serveOnly) {
    const { runTui } = await import('../../tui/src/index');
    runTui({ serverUrl: `http://localhost:${port}` });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
