import { Effect } from 'effect';
import type { AgentProfile } from '../subagent/types.js';
import { PLAN_PROFILE, BUILD_PROFILE, SubagentService } from '../subagent/registry.js';
import type { ToolVisibilityPolicy } from '../tools/types.js';
import { HookService } from '../hooks/registry.js';
import { McpService } from '../mcp/index.js';
import { RulesService } from '../rules/index.js';
import { SessionService } from '../session/store.js';
import { normalizePath } from '../core/path.js';
import type { PermissionMode } from '../approval/types.js';
import type { SessionMode } from '../session/types.js';
import { readCurrentIndex } from '../session/file-ops.js';
import { computePaths } from '../core/path.js';
import { isPlanProfile, PLAN_MODE_ALLOWED_TOOLS } from '../plan/index.js';

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

      subagent.registerGlobal([BUILD_PROFILE, PLAN_PROFILE]);

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
          if (!name) return undefined;
          return subagent.get(projectPath, name);
        },

        resolveSubagentProfile: (projectPath: string, name: string): AgentProfile | undefined => {
          const norm = normalizePath(projectPath);
          if (!prepared.has(norm)) prepared.add(norm);
          return subagent.get(norm, name);
        },

        getToolPolicy: (profile: AgentProfile | undefined): ToolVisibilityPolicy => ({
          allowedTools: isPlanProfile(profile) ? new Set(PLAN_MODE_ALLOWED_TOOLS) : undefined,
          allowedMcpServers: undefined,
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
            rules.evictProjectRules(norm);
          }),
      };
    }),
  }
) {}
