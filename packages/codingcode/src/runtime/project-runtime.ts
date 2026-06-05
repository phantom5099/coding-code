import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/registry';
import { EXPLORE_PROFILE } from '../subagent/registry';
import * as agentLoader from '../subagent/loader';
import type { ToolVisibilityPolicy } from '../tools/types';
import { HookService } from '../hooks/registry';
import { McpService } from '../mcp/index';
import { evictProjectRules } from '../rules/index';
import { normalizePath } from '../core/path';

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
          const norm = normalizePath(projectPath);
          if (prepared.has(norm)) return;
          prepared.add(norm);
          evictProjectRules(norm);
          yield* hooks.reloadUserHooks(norm).pipe(Effect.catchAll(() => Effect.void));
          yield* mcp.syncConnections(norm).pipe(Effect.catchAll(() => Effect.void));
          cachedSubagentProfiles.set(norm, buildProfiles(norm));
        }),

      resolveMainAgentProfile: (projectPath: string, sessionId: string): AgentProfile => {
        const sessionOverride = sessionAgentProfiles.get(sessionId);
        if (sessionOverride) return sessionOverride;
        const fromFile = agentLoader.loadMainAgentProfile(projectPath);
        if (fromFile) return fromFile;
        return agentLoader.DEFAULT_MAIN_PROFILE;
      },

      resolveSubagentProfile: (projectPath: string, name: string): AgentProfile | undefined => {
        const norm = normalizePath(projectPath);
        const cached = cachedSubagentProfiles.get(norm);
        const profiles = cached ?? buildProfiles(norm);
        return profiles.find((p) => p.name === name);
      },

      listAgentProfiles: (projectPath: string): AgentProfile[] => {
        const normalized = normalizePath(projectPath);
        const cached = cachedSubagentProfiles.get(normalized);
        return cached ? [...cached] : buildProfiles(normalized);
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
          const norm = normalizePath(projectPath);
          prepared.delete(norm);
          cachedSubagentProfiles.delete(norm);
          evictProjectRules(norm);
        }),
    };
  }),
}) {}
