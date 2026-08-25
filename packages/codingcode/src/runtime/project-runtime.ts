import { Effect } from 'effect';
import type { AgentProfile, AgentProfileName } from '../subagent/types.js';
import type { ToolVisibilityPolicy } from '../tools/types.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { RulesService } from '../rules/index.js';
import { SessionService } from '../session/store.js';
import { normalizePath } from '../core/path.js';
import type { PermissionMode } from '../approval/types.js';
import { readCurrentIndex } from '../session/file-ops.js';
import { computePaths } from '../core/path.js';
import {
  BUILD_PROFILE,
  PLAN_PROFILE,
  isPlanProfile,
  PLAN_PROFILE_ALLOWED_TOOLS,
} from '../agent/profile.js';

function isAgentProfileName(name: string): name is AgentProfileName {
  return name === PLAN_PROFILE.name || name === BUILD_PROFILE.name;
}

function profileByName(name: AgentProfileName): AgentProfile {
  return name === PLAN_PROFILE.name ? PLAN_PROFILE : BUILD_PROFILE;
}

export class ProjectRuntimeService extends Effect.Service<ProjectRuntimeService>()(
  'ProjectRuntime',
  {
    effect: Effect.gen(function* () {
      const hooks = yield* HookService;
      const mcp = yield* McpService;
      const rules = yield* RulesService;
      const session = yield* SessionService;
      const prepared = new Set<string>();

      return {
        prepareProject: (projectPath: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            const norm = normalizePath(projectPath);
            if (prepared.has(norm)) return;
            prepared.add(norm);
            rules.evictProjectRules(norm);
            yield* hooks.reloadUserHooks(norm).pipe(Effect.catchAll(() => Effect.void));
            yield* mcp.syncConnections(norm).pipe(Effect.catchAll(() => Effect.void));
          }),

        resolveMainAgentProfile: (
          projectPath: string,
          sessionId: string
        ): AgentProfile | undefined => {
          const idx = readCurrentIndex(computePaths(projectPath, sessionId).indexPath);
          const name = idx?.activeProfile;
          return name ? profileByName(name) : undefined;
        },

        resolveSubagentProfile: (_projectPath: string, name: string): AgentProfile | undefined =>
          isAgentProfileName(name) ? profileByName(name) : undefined,

        getToolPolicy: (profile: AgentProfile | undefined): ToolVisibilityPolicy => ({
          allowedTools: isPlanProfile(profile) ? new Set(PLAN_PROFILE_ALLOWED_TOOLS) : undefined,
          allowedMcpServers: undefined,
        }),

        setSessionProfile: (
          projectPath: string,
          sessionId: string,
          profile: AgentProfile,
          permissionModeOverride?: PermissionMode
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            const effectivePerm: PermissionMode = permissionModeOverride ?? 'default';
            yield* session.setPermissionModeOnDisk(projectPath, sessionId, effectivePerm);
            yield* session.setActiveProfile(projectPath, sessionId, profile.name);
          }),

        getSessionProfile: (
          sessionId: string,
          projectPath: string
        ): Effect.Effect<AgentProfile | undefined, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            const name = yield* session.getActiveProfile(projectPath, sessionId);
            return profileByName(name);
          }),

        getSessionPermissionMode: (
          sessionId: string,
          projectPath: string
        ): Effect.Effect<PermissionMode, import('../core/error.js').AgentError> =>
          session.getPermissionModeFromDisk(projectPath, sessionId),

        restoreSessionProfile: (
          projectPath: string,
          sessionId: string,
          profileName: AgentProfileName,
          permissionModeOverride?: PermissionMode
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            const profile = profileByName(profileName);
            const effectivePerm: PermissionMode = permissionModeOverride ?? 'default';
            yield* session.setPermissionModeOnDisk(projectPath, sessionId, effectivePerm);
            yield* session.setActiveProfile(projectPath, sessionId, profile.name);
          }),

        disposeSession: (_sessionId: string): Effect.Effect<void> => Effect.void,

        disposeProject: (projectPath: string): Effect.Effect<void> =>
          Effect.sync(() => {
            const norm = normalizePath(projectPath);
            prepared.delete(norm);
            rules.evictProjectRules(norm);
          }),
      };
    }),
  }
) {}
