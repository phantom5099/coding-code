import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/types.js';
import {
  EXPLORE_PROFILE,
  PLAN_PROFILE,
  BUILD_PROFILE,
  SubagentService,
} from '../subagent/registry.js';
import * as agentLoader from '../subagent/loader.js';
import type { ToolVisibilityPolicy } from '../tools/types.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { RulesService } from '../rules/index.js';
import { SessionService } from '../session/store.js';
import { normalizePath } from '../core/path.js';
import type { PermissionMode } from '../approval/types.js';
import type { SessionMode } from '../session/types.js';
import { readCurrentIndex } from '../session/file-ops.js';
import { computePaths } from '../core/paths.js';

function buildGlobalProfiles(): AgentProfile[] {
  const profiles: AgentProfile[] = [BUILD_PROFILE, EXPLORE_PROFILE, PLAN_PROFILE];
  for (const p of agentLoader.loadGlobalAgentProfiles()) {
    if (!profiles.find((existing) => existing.name === p.name)) {
      profiles.push(p);
    }
  }
  return profiles;
}

function buildProjectProfiles(projectPath: string): AgentProfile[] {
  return agentLoader.loadAgentProfiles(projectPath);
}

export function modeToProfile(mode: SessionMode): AgentProfile {
  return mode === 'plan' ? PLAN_PROFILE : BUILD_PROFILE;
}

export class ProjectRuntimeService extends Effect.Service<ProjectRuntimeService>()(
  'ProjectRuntime',
  {
    effect: Effect.gen(function* () {
      const hooks = yield* HookService;
      const mcp = yield* McpService;
      const subagent = yield* SubagentService;
      const rules = yield* RulesService;
      const session = yield* SessionService;
      const prepared = new Set<string>();

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

        resolveMainAgentProfile: (
          projectPath: string,
          sessionId: string
        ): AgentProfile | undefined => {
          const idx = readCurrentIndex(computePaths(projectPath, sessionId).indexPath);
          const name = idx?.activeProfile;
          if (!name) return agentLoader.loadMainAgentProfile(projectPath);
          return subagent.get(projectPath, name) ?? agentLoader.loadMainAgentProfile(projectPath);
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

        setSessionProfile: (
          projectPath: string,
          sessionId: string,
          profile: AgentProfile,
          permissionModeOverride?: PermissionMode
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            const mode: SessionMode = profile.name === 'plan' ? 'plan' : 'build';
            const effectivePerm: PermissionMode =
              permissionModeOverride ?? profile.permissionMode ?? 'default';
            yield* session.setModeOnDisk(projectPath, sessionId, mode);
            yield* session.setPermissionModeOnDisk(projectPath, sessionId, effectivePerm);
            yield* session.setActiveProfile(projectPath, sessionId, profile.name);
          }),

        getSessionProfile: (
          sessionId: string,
          projectPath: string
        ): Effect.Effect<AgentProfile | undefined, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            const name = yield* session.getActiveProfile(projectPath, sessionId);
            if (!name) return undefined;
            return subagent.get(projectPath, name);
          }),

        getSessionPermissionMode: (
          sessionId: string,
          projectPath: string
        ): Effect.Effect<PermissionMode, import('../core/error.js').AgentError> =>
          session.getPermissionModeFromDisk(projectPath, sessionId),

        restoreSessionProfile: (
          projectPath: string,
          sessionId: string,
          profileName: string | undefined,
          permissionModeOverride?: PermissionMode
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            if (!profileName) return;
            const profile = subagent.get(projectPath, profileName);
            if (!profile) return;
            const mode: SessionMode = profile.name === 'plan' ? 'plan' : 'build';
            const effectivePerm: PermissionMode =
              permissionModeOverride ?? profile.permissionMode ?? 'default';
            yield* session.setModeOnDisk(projectPath, sessionId, mode);
            yield* session.setPermissionModeOnDisk(projectPath, sessionId, effectivePerm);
            yield* session.setActiveProfile(projectPath, sessionId, profile.name);
          }),

        disposeSession: (_sessionId: string): Effect.Effect<void> => Effect.void,

        disposeProject: (projectPath: string): Effect.Effect<void> =>
          Effect.sync(() => {
            const norm = normalizePath(projectPath);
            prepared.delete(norm);
            subagent.resetProject(norm);
            rules.evictProjectRules(norm);
          }),
      };
    }),
  }
) {}
