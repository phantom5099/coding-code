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

function profileToPermissionMode(profile: AgentProfile | undefined): PermissionMode {
  return profile?.permissionMode ?? 'default';
}

/** 构建项目级 profile：<project>/.codingcode/agents/ */
function buildProjectProfiles(projectPath: string): AgentProfile[] {
  return agentLoader.loadAgentProfiles(projectPath);
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
          profile: AgentProfile
        ): Effect.Effect<void> =>
          Effect.gen(function* () {
            sessionAgentProfiles.set(sessionId, profile);
            const mode = profileToPermissionMode(profile);
            sessionPermissionModes.set(sessionId, mode);
            // 写盘：跨重启恢复时 messages.ts 从 idx 读 permissionMode + activeProfile
            const state = yield* session.load(projectPath, sessionId);
            yield* session.setPermissionMode(state, mode);
            yield* session.updateActiveProfile(state, profile.name);
          }),

        getSessionProfile: (sessionId: string): AgentProfile | undefined =>
          sessionAgentProfiles.get(sessionId),

        getSessionPermissionMode: (sessionId: string): PermissionMode =>
          sessionPermissionModes.get(sessionId) ?? 'default',

        restoreSessionProfile: (
          projectPath: string,
          sessionId: string,
          profileName: string | undefined
        ): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (!profileName) return;
            const norm = normalizePath(projectPath);
            const profile = subagent.get(norm, profileName);
            if (!profile) return;
            sessionAgentProfiles.set(sessionId, profile);
            const mode = profileToPermissionMode(profile);
            sessionPermissionModes.set(sessionId, mode);
            // 写盘：保持 idx 状态与内存态一致
            const state = yield* session.load(projectPath, sessionId);
            yield* session.setPermissionMode(state, mode);
          }),

        disposeSession: (sessionId: string): Effect.Effect<void> =>
          Effect.sync(() => {
            sessionAgentProfiles.delete(sessionId);
            sessionPermissionModes.delete(sessionId);
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
