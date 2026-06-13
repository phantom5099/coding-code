import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/types.js';
import { EXPLORE_PROFILE, PLAN_PROFILE, SubagentService } from '../subagent/registry.js';
import * as agentLoader from '../subagent/loader.js';
import type { ToolVisibilityPolicy } from '../tools/types.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { RulesService } from '../rules/index.js';
import { normalizePath } from '../core/path.js';

/** 构建全局 profile：内置 + ~/.codingcode/agents/ */
function buildGlobalProfiles(): AgentProfile[] {
  const profiles: AgentProfile[] = [EXPLORE_PROFILE, PLAN_PROFILE];
  for (const p of agentLoader.loadGlobalAgentProfiles()) {
    if (!profiles.find((existing) => existing.name === p.name)) {
      profiles.push(p);
    }
  }
  return profiles;
}

/** 构建项目级 profile：<project>/.codingcode/agents/ */
function buildProjectProfiles(projectPath: string): AgentProfile[] {
  return agentLoader.loadAgentProfiles(projectPath);
}

export class ProjectRuntimeService extends Effect.Service<ProjectRuntimeService>()('ProjectRuntime', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const subagent = yield* SubagentService;
    const rules = yield* RulesService;
    const sessionAgentProfiles = new Map<string, AgentProfile>();
    const prepared = new Set<string>();

    // 启动时注册全局 profile（内置 + ~/.codingcode/agents/），只做一次
    subagent.registerGlobal(buildGlobalProfiles());

    return {
      prepareProject: (projectPath: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const norm = normalizePath(projectPath);
          if (prepared.has(norm)) return;
          prepared.add(norm);
          rules.evictProjectRules(norm);
          yield* hooks.reloadUserHooks(norm).pipe(Effect.catchAll(() => Effect.void));
          yield* mcp.syncConnections(norm).pipe(Effect.catchAll(() => Effect.void));
          subagent.registerProject(norm, buildProjectProfiles(norm));
        }),

      resolveMainAgentProfile: (projectPath: string, sessionId: string): AgentProfile | undefined => {
        const sessionOverride = sessionAgentProfiles.get(sessionId);
        if (sessionOverride) return sessionOverride;
        return agentLoader.loadMainAgentProfile(projectPath);
      },

      resolveSubagentProfile: (projectPath: string, name: string): AgentProfile | undefined => {
        const norm = normalizePath(projectPath);
        if (!prepared.has(norm)) {
          subagent.registerProject(norm, buildProjectProfiles(norm));
          prepared.add(norm);
        }
        return subagent.get(norm, name);
      },

      listAgentProfiles: (projectPath: string): AgentProfile[] => {
        const normalized = normalizePath(projectPath);
        if (!prepared.has(normalized)) {
          subagent.registerProject(normalized, buildProjectProfiles(normalized));
          prepared.add(normalized);
        }
        return subagent.list(normalized);
      },

      getToolPolicy: (profile: AgentProfile | undefined): ToolVisibilityPolicy => ({
        allowedTools: profile?.tools ? new Set(profile.tools) : undefined,
        allowedMcpServers: profile?.mcpServers ? new Set(profile.mcpServers) : undefined,
        allowToolSearch: true,
        allowDeferredTools: false,
      }),

      setSessionProfile: (sessionId: string, profile: AgentProfile): void => {
        sessionAgentProfiles.set(sessionId, profile);
      },

      getSessionProfile: (sessionId: string): AgentProfile | undefined =>
        sessionAgentProfiles.get(sessionId),

      disposeSession: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => { sessionAgentProfiles.delete(sessionId); }),

      disposeProject: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const norm = normalizePath(projectPath);
          prepared.delete(norm);
          subagent.resetProject(norm);
          rules.evictProjectRules(norm);
        }),
    };
  }),
}) {}
