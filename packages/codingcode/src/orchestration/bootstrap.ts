import { Effect } from 'effect';
import { ToolService } from '../tools/registry.js';
import { SandboxService } from '../sandbox/index.js';
import { SubagentRegistry, EXPLORE_PROFILE } from '../subagent/registry.js';
import { SessionService } from '../session/store.js';
import { ApprovalService } from '../approval/index.js';
import { HookService } from '../hooks/registry.js';
import { ToolSearchService } from '../tools/tool-search-service.js';
import { McpService } from '../mcp/index.js';
import { readFileTool } from '../tools/domains/fs/read.js';
import { writeFileTool } from '../tools/domains/fs/write.js';
import { editFileTool } from '../tools/domains/fs/edit.js';
import { bashTool } from '../tools/domains/bash/exec.js';
import { searchTool } from '../tools/domains/fs/grep.js';
import { globTool } from '../tools/domains/fs/glob.js';
import { webFetchTool } from '../tools/domains/web/fetch.js';
import { webSearchTool } from '../tools/domains/web/search.js';
import { todoWriteTool } from '../tools/domains/self/todo-write.js';
import { todoReadTool } from '../tools/domains/self/todo-read.js';
import { createToolSearchTool } from '../tools/domains/self/tool-search.js';
import { createDispatchAgentTool } from '../tools/domains/subagent/dispatch.js';
import { loadAgentProfiles } from '../subagent/loader.js';

export const bootstrapApplication = (cwd: string) =>
  Effect.gen(function* () {
    const tools = yield* ToolService;
    const sandbox = yield* SandboxService;
    const subagentRegistry = yield* SubagentRegistry;
    const session = yield* SessionService;
    const approval = yield* ApprovalService;
    const hooks = yield* HookService;
    const toolSearchSvc = yield* ToolSearchService;
    const mcp = yield* McpService;

    yield* sandbox.initialize({
      denyReadPaths: ['/etc/shadow', '/etc/passwd'],
      denyWritePaths: ['/', '/etc', '/sys', '/proc'],
    });

    yield* tools.register(readFileTool);
    yield* tools.register(writeFileTool);
    yield* tools.register(editFileTool);
    yield* tools.register(bashTool);
    yield* tools.register(searchTool);
    yield* tools.register(globTool);
    yield* tools.register(webFetchTool);
    yield* tools.register(webSearchTool);
    yield* tools.register(todoWriteTool);
    yield* tools.register(todoReadTool);
    yield* tools.register(createToolSearchTool(toolSearchSvc));

    subagentRegistry.register(EXPLORE_PROFILE);
    for (const profile of loadAgentProfiles(cwd)) {
      subagentRegistry.register(profile);
    }

    yield* tools.register(
      createDispatchAgentTool({ session, approval, hooks, registry: subagentRegistry, mcp }),
    );
  });