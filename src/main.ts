import { HookRegistry } from './core/hooks';
import { ToolRegistry } from './tools/registry';
import { ToolExecutor } from './tools/executor';
import { getLLMClient } from './llm/factory';
import { Agent } from './agent/agent';
import { CliApp } from './presentation/cli/app';
import { StdioTransport } from './transport/stdio';
import { runTui } from './presentation/tui/index.js';
import { SessionStore } from './session/store';
import { DefaultSandbox } from './sandbox';
import { readFileTool } from './tools/domains/fs/read';
import { writeFileTool } from './tools/domains/fs/write';
import { listDirTool } from './tools/domains/fs/list';
import { bashTool } from './tools/domains/bash/exec';
import { searchTool } from './tools/domains/search/grep';
import { webFetchTool } from './tools/domains/web/fetch';

async function main() {
  const hooks = new HookRegistry();

  const tools = new ToolRegistry()
    .register(readFileTool)
    .register(writeFileTool)
    .register(listDirTool)
    .register(bashTool)
    .register(searchTool)
    .register(webFetchTool);

  const sandbox = new DefaultSandbox();
  const executor = new ToolExecutor(tools, hooks, sandbox);

  const llmResult = await getLLMClient();
  if (!llmResult.ok) {
    console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
    process.exit(1);
  }

  const sessionStore = new SessionStore(process.cwd());
  const llm = llmResult.value;

  sessionStore.init(llm.modelInfo.model, 'coder', '0.1.0');

  const agent = new Agent(
    { llm, executor, hooks },
    { role: 'coder' },
    sessionStore,
  );

  const useCli = process.argv.includes('--cli');

  if (useCli) {
    const transport = new StdioTransport();
    const app = new CliApp(transport, agent, sessionStore);
    await app.run();
  } else {
    runTui(agent, sessionStore);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
