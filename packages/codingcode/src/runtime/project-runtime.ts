import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/registry.js';
import { EXPLORE_PROFILE, PLAN_PROFILE, SubagentRegistry } from '../subagent/registry.js';
import * as agentLoader from '../subagent/loader.js';
import type { ToolVisibilityPolicy } from '../tools/types.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { evictProjectRules } from '../rules/index.js';
import { normalizePath } from '../core/path.js';

export class ProjectRuntimeService extends Effect.Service<ProjectRuntimeService>()(
  'ProjectRuntime',
  {
    effect: Effect.gen(function* () {
      const hooks = yield* HookService;
      const mcp = yield* McpService;
      const subagentRegistry = yield* SubagentRegistry;

      const sessionAgentProfiles = new Map<string, AgentProfile>();
      const prepared = new Set<string>();

      function buildProfiles(projectPath: string): AgentProfile[] {
        const profiles: AgentProfile[] = [];
        profiles.push(EXPLORE_PROFILE);
        profiles.push(PLAN_PROFILE);

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
            const profiles = buildProfiles(norm);
            subagentRegistry.reset();
            subagentRegistry.registerAll(profiles);
          }),

        resolveMainAgentProfile: (
          projectPath: string,
          sessionId: string
        ): AgentProfile | undefined => {
          const sessionOverride = sessionAgentProfiles.get(sessionId);
          if (sessionOverride) return sessionOverride;
          return agentLoader.loadMainAgentProfile(projectPath);
        },

        resolveSubagentProfile: (_projectPath: string, name: string): AgentProfile | undefined => {
          // First check if not yet prepared (lazy init)
          const cached = subagentRegistry.get(name);
          if (cached) return cached;
          // Lazy init: build profiles and register if not yet populated
          const norm = normalizePath(_projectPath);
          if (!prepared.has(norm)) {
            const profiles = buildProfiles(norm);
            subagentRegistry.registerAll(profiles);
          }
          return subagentRegistry.get(name);
        },

        listAgentProfiles: (projectPath: string): AgentProfile[] => {
          const normalized = normalizePath(projectPath);
          if (!prepared.has(normalized)) {
            const profiles = buildProfiles(normalized);
            subagentRegistry.registerAll(profiles);
            prepared.add(normalized);
          }
          return subagentRegistry.list();
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
          Effect.sync(() => {
            sessionAgentProfiles.delete(sessionId);
          }),

        disposeProject: (projectPath: string): Effect.Effect<void> =>
          Effect.sync(() => {
            const norm = normalizePath(projectPath);
            prepared.delete(norm);
            subagentRegistry.reset();
            evictProjectRules(norm);
          }),
      };
    }),
  }
) {}
