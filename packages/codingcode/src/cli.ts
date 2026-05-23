import { Effect } from 'effect';
import { createServer as createNetServer } from 'net';
import { serve } from '@hono/node-server';
import { ToolService } from './tools/registry.js';
import { HookService } from './hooks/registry.js';
import { McpService } from './mcp/index.js';
import { SkillService } from './skills/index.js';
import { getLLMClient } from './llm/factory.js';
import { SandboxService } from './sandbox/index.js';
import { readFileTool } from './tools/domains/fs/read.js';
import { writeFileTool } from './tools/domains/fs/write.js';
import { editFileTool } from './tools/domains/fs/edit.js';
import { bashTool } from './tools/domains/bash/exec.js';
import { searchTool } from './tools/domains/fs/grep.js';
import { globTool } from './tools/domains/fs/glob.js';
import { webFetchTool } from './tools/domains/web/fetch.js';
import { webSearchTool } from './tools/domains/web/search.js';
import { createServer } from './server/index.js';
import { AppLayer } from './layer.js';
import { loadConfig } from '../../infra/src/config.js';
import { getWorkspaceCwd, initWorkspace, parseWorkspaceArgs } from './core/workspace.js';
import { todoWriteTool } from './tools/domains/agent-state/todo-write.js';
import { todoReadTool } from './tools/domains/agent-state/todo-read.js';
import { toolSearchTool, bindToolSearchService } from './tools/domains/agent-state/tool-search.js';
import { ToolSearchService } from './tools/tool-search-service.js';
import { SubagentRegistry, EXPLORE_PROFILE, GENERAL_PROFILE } from './subagent/registry.js';
import { loadAgentProfiles } from './subagent/loader.js';
import { createDispatchAgentTool } from './subagent/dispatch-tool.js';
import { AgentIdResolver } from './agent-state/agent-id.js';
import { ApprovalService } from './approval/index.js';
import { SessionService } from './session/store.js';

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
  const installRoot = process.cwd();
  const { workspaceCwd, args } = parseWorkspaceArgs(process.argv.slice(2));
  initWorkspace({ installRoot, workspaceCwd });
  if (workspaceCwd) {
    console.log(`Workspace: ${getWorkspaceCwd()}`);
  }
  const serveOnly = args.includes('serve');
  const tuiOnly = args.includes('tui');
  const config = loadConfig(undefined, installRoot);
  const basePort = config.server.port;

  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const skill = yield* SkillService;
    const sandbox = yield* SandboxService;

    // Initialize sandbox (will gracefully degrade if @vscode/sandbox-runtime is unavailable)
    yield* sandbox.initialize({});

    // Register built-in tools
    yield* tools.register(readFileTool);
    yield* tools.register(writeFileTool);
    yield* tools.register(editFileTool);
    yield* tools.register(bashTool);
    yield* tools.register(searchTool);
    yield* tools.register(globTool);
    yield* tools.register(webFetchTool);
    yield* tools.register(webSearchTool);

    // Register deferred state-management tools
    yield* tools.register(todoWriteTool);
    yield* tools.register(todoReadTool);
    yield* tools.register(toolSearchTool);

    // Bind ToolSearchService for tool_search tool (needs Effect runtime)
    const toolSearchSvc = yield* ToolSearchService;
    bindToolSearchService(toolSearchSvc);

    // Setup subagent profiles and dispatch tool
    const subagentRegistry = yield* SubagentRegistry;
    const session = yield* SessionService;
    const approval = yield* ApprovalService;
    const agentIdResolver = yield* AgentIdResolver;

    // Register built-in profiles
    subagentRegistry.register(EXPLORE_PROFILE);
    subagentRegistry.register(GENERAL_PROFILE);

    // Load custom profiles from project
    const customProfiles = loadAgentProfiles(getWorkspaceCwd());
    for (const profile of customProfiles) {
      subagentRegistry.register(profile);
    }

    // Register dispatch_agent tool
    const dispatchTool = createDispatchAgentTool({
      session,
      agentIdResolver,
      approval,
      hooks,
      registry: subagentRegistry,
    });
    yield* tools.register(dispatchTool);

    // Connect MCP servers (auto-registers tools to ToolService)
    yield* mcp.connectAll(getWorkspaceCwd());

    // Load skills
    yield* skill.loadAll(getWorkspaceCwd());

    // Initialize LLM
    const llmResult = yield* Effect.tryPromise(() => getLLMClient());
    if (!llmResult.ok) {
      console.error(`Failed to initialize LLM client: ${llmResult.error.message}`);
      process.exit(1);
    }

    // Find available port
    const port = yield* Effect.tryPromise(() => findAvailablePort(basePort));

    if (tuiOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      runTui({ llm: llmResult.value });
      return;
    }

    // ToolExecutorService, ApprovalService, SandboxService all provided via AppLayer
    const app = createServer({ llm: llmResult.value });
    serve({ fetch: app.fetch, port });

    if (!serveOnly) {
      const tuiPath = '../../tui/src/index.js';
      const { runTui } = yield* Effect.tryPromise(() => import(tuiPath));
      runTui({ llm: llmResult.value });
    }
  });

  await Effect.runPromise(program.pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
