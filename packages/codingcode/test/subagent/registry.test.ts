import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { SubagentService, EXPLORE_PROFILE, PLAN_PROFILE } from '../../src/subagent/registry';
import type { AgentProfile } from '../../src/subagent/types';

describe('SubagentService', () => {
  it('should register global profiles and retrieve them', async () => {
    const profile: AgentProfile = {
      name: 'test-agent',
      description: 'Test agent',
      systemPrompt: 'You are a test agent',
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([profile]);
        return svc.get('', 'test-agent');
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(result).toEqual(profile);
  });

  it('should register project profiles and retrieve with project path', async () => {
    const globalProfile: AgentProfile = {
      name: 'global-agent',
      description: 'Global agent',
      systemPrompt: 'Global system',
    };
    const projectProfile: AgentProfile = {
      name: 'project-agent',
      description: 'Project agent',
      systemPrompt: 'Project system',
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([globalProfile]);
        svc.registerProject('/project/a', [projectProfile]);
        return {
          globalViaProject: svc.get('/project/a', 'global-agent'),
          projectViaProject: svc.get('/project/a', 'project-agent'),
          projectViaEmpty: svc.get('', 'project-agent'),
        };
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(result.globalViaProject).toEqual(globalProfile);
    expect(result.projectViaProject).toEqual(projectProfile);
    expect(result.projectViaEmpty).toBeUndefined();
  });

  it('should let project profile override global profile with same name', async () => {
    const globalProfile: AgentProfile = {
      name: 'shared',
      description: 'Global version',
      systemPrompt: 'Global system',
    };
    const projectProfile: AgentProfile = {
      name: 'shared',
      description: 'Project version',
      systemPrompt: 'Project system',
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([globalProfile]);
        svc.registerProject('/project/a', [projectProfile]);
        return {
          fromProject: svc.get('/project/a', 'shared'),
          fromGlobal: svc.get('', 'shared'),
        };
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(result.fromProject?.description).toBe('Project version');
    expect(result.fromGlobal?.description).toBe('Global version');
  });

  it('should return undefined for unknown profile', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        return svc.get('', 'unknown-agent');
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(result).toBeUndefined();
  });

  it('should support built-in explore profile', () => {
    expect(EXPLORE_PROFILE.name).toBe('explore');
    expect(EXPLORE_PROFILE.readonly).toBe(true);
    expect(EXPLORE_PROFILE.maxSteps).toBe(180);
    expect(EXPLORE_PROFILE.tools).toContain('read_file');
    expect(EXPLORE_PROFILE.tools).toContain('search_files');
    expect(EXPLORE_PROFILE.tools).toContain('search_code');
    expect(EXPLORE_PROFILE.tools).toContain('fetch_url');
    expect(EXPLORE_PROFILE.tools).toContain('tool_search');
  });

  it('explore profile systemPrompt includes guidelines', () => {
    expect(EXPLORE_PROFILE.systemPrompt).toContain('Start broad, then narrow down');
    expect(EXPLORE_PROFILE.systemPrompt).toContain('Call multiple tools in parallel');
    expect(EXPLORE_PROFILE.systemPrompt).toContain('file_path:line_number');
  });

  it('should support built-in plan profile', () => {
    expect(PLAN_PROFILE.name).toBe('plan');
    // After the plan refactor, PLAN_PROFILE does not set a `permissionMode`.
    // Plan mode is detected structurally via `isPlanProfile(profile)` and
    // enforced by the `plan/planModeGateHook` registered on `tool.approval.pre`.
    // The approval pipeline itself only sees generic permission modes.
    expect(PLAN_PROFILE.permissionMode).toBeUndefined();
    expect(PLAN_PROFILE.isPrimary).toBe(true);
    expect(PLAN_PROFILE.maxSteps).toBe(180);
    expect(PLAN_PROFILE.tools).toContain('read_file');
    expect(PLAN_PROFILE.tools).toContain('search_files');
    expect(PLAN_PROFILE.tools).toContain('search_code');
    expect(PLAN_PROFILE.tools).toContain('fetch_url');
    expect(PLAN_PROFILE.tools).toContain('tool_search');
    expect(PLAN_PROFILE.tools).toContain('submit_plan');
    expect(PLAN_PROFILE.tools).toContain('dispatch_agent');
    // Write tools are intentionally absent — the plan-mode gate hook denies
    // them at approval time, and the catalog must not advertise them.
    expect(PLAN_PROFILE.tools).not.toContain('write_file');
    expect(PLAN_PROFILE.tools).not.toContain('edit_file');
    expect(PLAN_PROFILE.tools).not.toContain('execute_command');
  });

  it('plan profile systemPrompt includes research process and output format', () => {
    expect(PLAN_PROFILE.systemPrompt).toContain('Research process');
    expect(PLAN_PROFILE.systemPrompt).toContain('Output format');
    expect(PLAN_PROFILE.systemPrompt).toContain('Current state');
    expect(PLAN_PROFILE.systemPrompt).toContain('Key files');
    expect(PLAN_PROFILE.systemPrompt).toContain('Recommended approach');
  });

  it('should list profiles with project override', async () => {
    const globalProfile: AgentProfile = {
      name: 'agent1',
      description: 'Global agent1',
      systemPrompt: 'S1',
    };
    const projectProfile: AgentProfile = {
      name: 'agent1',
      description: 'Project agent1',
      systemPrompt: 'S1-project',
    };
    const projectOnly: AgentProfile = {
      name: 'agent2',
      description: 'Project only',
      systemPrompt: 'S2',
    };

    const all = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([globalProfile]);
        svc.registerProject('/project/a', [projectProfile, projectOnly]);
        return svc.list('/project/a');
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(all.length).toBe(2);
    expect(all.find((p) => p.name === 'agent1')?.description).toBe('Project agent1');
    expect(all.find((p) => p.name === 'agent2')?.description).toBe('Project only');
  });

  it('should reset project registry without affecting global', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([
          {
            name: 'global-agent',
            description: 'Global',
            systemPrompt: 'G',
          },
        ]);
        svc.registerProject('/project/a', [
          {
            name: 'project-agent',
            description: 'Project',
            systemPrompt: 'P',
          },
        ]);

        expect(svc.get('/project/a', 'project-agent')).toBeDefined();
        expect(svc.get('/project/a', 'global-agent')).toBeDefined();

        svc.resetProject('/project/a');

        return {
          projectAfterReset: svc.get('/project/a', 'project-agent'),
          globalAfterReset: svc.get('/project/a', 'global-agent'),
        };
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(result.projectAfterReset).toBeUndefined();
    expect(result.globalAfterReset).toBeDefined();
  });

  it('list without project returns global profiles only', async () => {
    const all = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SubagentService;
        svc.registerGlobal([
          { name: 'g1', description: 'Global 1', systemPrompt: 's1' },
          { name: 'g2', description: 'Global 2', systemPrompt: 's2' },
        ]);
        svc.registerProject('/project/a', [
          { name: 'p1', description: 'Project 1', systemPrompt: 's3' },
        ]);
        return {
          globalList: svc.list(''),
          projectList: svc.list('/project/a'),
        };
      }).pipe(Effect.provide(SubagentService.Default))
    );

    expect(all.globalList.length).toBe(2);
    expect(all.projectList.length).toBe(3);
    expect(all.globalList.some((p) => p.name === 'p1')).toBe(false);
    expect(all.projectList.some((p) => p.name === 'p1')).toBe(true);
  });
});
