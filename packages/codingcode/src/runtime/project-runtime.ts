import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/registry';
import { EXPLORE_PROFILE } from '../subagent/registry';
import * as agentLoader from '../subagent/loader';
import type { ToolVisibilityPolicy } from '../tools/visibility';
import { HookService } from '../hooks/registry';
import { McpService } from '../mcp/index';
import { evictProjectRules } from '../rules/index';

export class ProjectRuntimeService extends Effect.Service<ProjectRuntimeService>()('ProjectRuntime', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const mcp = yield* McpService;

    const sessionAgentProfiles = new Map<string, AgentProfile>();
    const cachedSubagentProfiles = new Map<string, AgentProfile[]>();
    const prepared = new Set<string>();

    function buildProfiles(projectPath: string): AgentProfile[] {
      const profiles: AgentProfile[] = [];
      profiles.push(EXPLORE_PROFILE);

      for (const p of agentLoader.loadGlobalAgentProfiles()) {
        if (!profiles.find((existing) => existing.name === p.name)) {
          profiles.push(p);
        }
      }
      for (const p of agentLoader.loadAgentProfiles(projectPath)) {
        const idx = profiles.findIndex((existing) => existing.name === p.name);
        if (idx >= 0) {
          profiles[idx] = p;
        } else {
          profiles.push(p);
        }
      }
      return profiles;
    }

    return {
      prepareProject: (projectPath: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (prepared.has(projectPath)) return;
          prepared.add(projectPath);
          evictProjectRules(projectPath);
          yield* hooks.reloadUserHooks(projectPath);
          yield* mcp.syncConnections(projectPath);
          cachedSubagentProfiles.set(projectPath, buildProfiles(projectPath));
        }),

      resolveMainAgentProfile: (projectPath: string, sessionId: string): AgentProfile => {
        const sessionOverride = sessionAgentProfiles.get(sessionId);
        if (sessionOverride) return sessionOverride;
        const fromFile = agentLoader.loadMainAgentProfile(projectPath);
        if (fromFile) return fromFile;
        return agentLoader.DEFAULT_MAIN_PROFILE;
      },

      resolveSubagentProfile: (projectPath: string, name: string): AgentProfile | undefined => {
        const cached = cachedSubagentProfiles.get(projectPath);
        if (cached) return cached.find((p) => p.name === name);
        return undefined;
      },

      listAgentProfiles: (projectPath: string): AgentProfile[] => {
        const cached = cachedSubagentProfiles.get(projectPath);
        return cached ? [...cached] : buildProfiles(projectPath);
      },

      getToolPolicy: (profile: AgentProfile): ToolVisibilityPolicy => ({
        allowedTools: profile.tools ? new Set(profile.tools) : undefined,
        allowedMcpServers: profile.mcpServers ? new Set(profile.mcpServers) : undefined,
        allowToolSearch: true,
        allowDeferredTools: false,
      }),

      setSessionProfile: (sessionId: string, profile: AgentProfile): void => {
        sessionAgentProfiles.set(sessionId, profile);
      },

      getSessionProfile: (sessionId: string): AgentProfile | undefined =>
        sessionAgentProfiles.get(sessionId),

      disposeSession: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          sessionAgentProfiles.delete(sessionId);
        }),

      disposeProject: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          prepared.delete(projectPath);
          cachedSubagentProfiles.delete(projectPath);
          evictProjectRules(projectPath);
        }),
    };
  }),
}) {}
