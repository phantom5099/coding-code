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
import { ApprovalService } from '../approval/index.js';
import type { PermissionMode } from '../approval/types.js';
import type { SessionMode } from '../session/types.js';
import { computePaths, readCurrentIndex, setPermissionMode } from '../session/file-ops.js';
import { writeFileSync } from 'fs';
import {
  isPlanProfile,
  markSessionPlanMode,
  clearPlanModeSession,
} from '../plan/index.js';

/** 构建全局 profile：内置 + ~/.codingcode/agents/ */
function buildGlobalProfiles(): AgentProfile[] {
  const profiles: AgentProfile[] = [BUILD_PROFILE, EXPLORE_PROFILE, PLAN_PROFILE];
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
      const sessionAgentProfiles = new Map<string, AgentProfile>();
      const sessionPermissionModes = new Map<string, PermissionMode>();
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

        resolveMainAgentProfile: (
          projectPath: string,
          sessionId: string
        ): AgentProfile | undefined => {
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

        setSessionProfile: (
          projectPath: string,
          sessionId: string,
          profile: AgentProfile,
          permissionModeOverride?: PermissionMode,
          parentSessionId?: string
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            sessionAgentProfiles.set(sessionId, profile);
            markSessionPlanMode(sessionId, isPlanProfile(profile));

            if (isPlanProfile(profile)) {
              // Plan 模式:内存 map 强制 'default',SessionIndex.permissionMode 不写盘(保留 build 偏好)
              sessionPermissionModes.set(sessionId, 'default');
              return;
            }

            const effectivePermissionMode: PermissionMode =
              permissionModeOverride ?? profile.permissionMode ?? 'default';
            sessionPermissionModes.set(sessionId, effectivePermissionMode);
            const paths = computePaths(projectPath, sessionId, parentSessionId);
            setPermissionMode(sessionId, paths.indexPath, effectivePermissionMode);
            // Update activeProfile in the same index file.
            const current = readCurrentIndex(paths.indexPath);
            if (current) {
              const index = {
                ...current,
                activeProfile: profile.name,
                updatedAt: new Date().toISOString(),
              };
              writeFileSync(paths.indexPath, JSON.stringify(index, null, 2), 'utf8');
            }
          }),

        getSessionProfile: (sessionId: string): AgentProfile | undefined =>
          sessionAgentProfiles.get(sessionId),

        getSessionPermissionMode: (sessionId: string): PermissionMode =>
          sessionPermissionModes.get(sessionId) ?? 'default',

        restoreSessionProfile: (
          projectPath: string,
          sessionId: string,
          profileName: string | undefined,
          permissionModeOverride?: PermissionMode,
          parentSessionId?: string
        ): Effect.Effect<void, import('../core/error.js').AgentError> =>
          Effect.gen(function* () {
            if (!profileName) return;
            const norm = normalizePath(projectPath);
            const profile = subagent.get(norm, profileName);
            if (!profile) return;
            sessionAgentProfiles.set(sessionId, profile);
            markSessionPlanMode(sessionId, isPlanProfile(profile));

            if (isPlanProfile(profile)) {
              sessionPermissionModes.set(sessionId, 'default');
              return;
            }

            const effectivePermissionMode: PermissionMode =
              permissionModeOverride ?? profile.permissionMode ?? 'default';
            sessionPermissionModes.set(sessionId, effectivePermissionMode);
            // Direct write — see setSessionProfile above.
            const paths = computePaths(projectPath, sessionId, parentSessionId);
            setPermissionMode(sessionId, paths.indexPath, effectivePermissionMode);
          }),

        disposeSession: (sessionId: string): Effect.Effect<void> =>
          Effect.sync(() => {
            sessionAgentProfiles.delete(sessionId);
            sessionPermissionModes.delete(sessionId);
            clearPlanModeSession(sessionId);
          }),

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
