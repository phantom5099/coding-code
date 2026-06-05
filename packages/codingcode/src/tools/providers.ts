import { z } from 'zod';
import type { ToolDefinition, ToolDescription } from './types';
import type { AgentProfile } from '../subagent/registry';
import type { ToolVisibilityPolicy } from './types';
import { readFileTool } from './domains/fs/read.js';
import { writeFileTool } from './domains/fs/write.js';
import { editFileTool } from './domains/fs/edit.js';
import { bashTool } from './domains/bash/exec.js';
import { searchTool } from './domains/fs/grep.js';
import { globTool } from './domains/fs/glob.js';
import { webFetchTool } from './domains/web/fetch.js';
import { webSearchTool } from './domains/web/search.js';
import { todoWriteTool } from './domains/self/todo-write.js';
import { todoReadTool } from './domains/self/todo-read.js';

export interface ToolBuildContext {
  projectPath: string;
  sessionId: string;
}

export interface BuiltinToolProvider {
  listBuiltinTools(ctx: ToolBuildContext): ToolDefinition[];
}

export interface ProjectToolProvider {
  listProjectTools(projectPath: string, ctx: ToolBuildContext): ToolDefinition[];
}

export interface SessionToolResolver {
  resolveTools(input: {
    projectPath: string;
    sessionId: string;
    profile: AgentProfile;
    policy: ToolVisibilityPolicy;
  }): ToolDescription[];
}

export const STATIC_BUILTIN_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  searchTool,
  globTool,
  webFetchTool,
  webSearchTool,
  todoWriteTool,
  todoReadTool,
];

// ---- Implementation factories ----

export function createBuiltinToolProvider(): BuiltinToolProvider {
  return {
    listBuiltinTools(_ctx: ToolBuildContext): ToolDefinition[] {
      return [...STATIC_BUILTIN_TOOLS];
    },
  };
}

export function createProjectToolProvider(
  listProjectMcpTools: (projectPath: string) => ToolDefinition[]
): ProjectToolProvider {
  return {
    listProjectTools(projectPath: string, _ctx: ToolBuildContext): ToolDefinition[] {
      return listProjectMcpTools(projectPath);
    },
  };
}

export function createSessionToolResolver(
  builtinProvider: BuiltinToolProvider,
  projectProvider: ProjectToolProvider,
  createToolSearch: () => ToolDefinition,
  createDispatchAgent: () => ToolDefinition
): SessionToolResolver {
  return {
    resolveTools(input: {
      projectPath: string;
      sessionId: string;
      profile: AgentProfile;
      policy: ToolVisibilityPolicy;
    }): ToolDescription[] {
      const ctx: ToolBuildContext = {
        projectPath: input.projectPath,
        sessionId: input.sessionId,
      };

      let tools: ToolDefinition[] = [
        ...builtinProvider.listBuiltinTools(ctx),
        ...projectProvider.listProjectTools(input.projectPath, ctx),
      ];

      tools.push(createToolSearch());
      tools.push(createDispatchAgent());

      if (input.profile.tools) {
        const allowed = new Set(input.profile.tools);
        tools = tools.filter((t) => allowed.has(t.name));
      }

      if (input.policy.allowedTools) {
        tools = tools.filter((t) => input.policy.allowedTools!.has(t.name));
      }

      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
      }));
    },
  };
}
