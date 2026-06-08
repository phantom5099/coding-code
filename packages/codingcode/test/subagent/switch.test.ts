import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getSubagentEnabledState,
  setSubagentEnabledState,
  getProjectSubagentEnabledState,
  setProjectSubagentEnabledState,
  resetProjectSubagentEnabledState,
  resolveSubagentEnabled,
  getGlobalAgentDisabledState,
  setGlobalAgentDisabledState,
  getProjectAgentDisabledState,
  setProjectAgentDisabledState,
  resetProjectAgentDisabledState,
  resolveAgentDisabled,
} from '../../src/subagent/registry.js';
import { buildSystemPrompt } from '../../src/agent/prompt.js';
import type { AgentProfile } from '../../src/subagent/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 临时项目目录用于测试
const TMP_PROJECT = join(__dirname, '__tmp_project_test__');

describe('Subagent switch', () => {
  describe('Global enabled state', () => {
    afterEach(() => {
      setSubagentEnabledState(true);
    });

    it('should default to enabled', () => {
      expect(getSubagentEnabledState()).toBe(true);
    });

    it('should persist disabled state', () => {
      setSubagentEnabledState(false);
      expect(getSubagentEnabledState()).toBe(false);
    });

    it('should persist enabled state', () => {
      setSubagentEnabledState(false);
      setSubagentEnabledState(true);
      expect(getSubagentEnabledState()).toBe(true);
    });
  });

  describe('System prompt filtering', () => {
    it('should filter out disabled agents from system prompt', () => {
      const profiles: AgentProfile[] = [
        { name: 'enabled-agent', description: 'I am enabled', disabled: false },
        { name: 'disabled-agent', description: 'I am disabled', disabled: true },
      ];

      const prompt = buildSystemPrompt({
        cwd: '/tmp',
        platform: 'linux',
        shell: 'bash',
        agentProfiles: profiles,
      });

      expect(prompt).toContain('enabled-agent');
      expect(prompt).not.toContain('disabled-agent');
    });

    it('should not inject Available Subagents when all agents are disabled', () => {
      const profiles: AgentProfile[] = [
        { name: 'disabled-agent', description: 'I am disabled', disabled: true },
      ];

      const prompt = buildSystemPrompt({
        cwd: '/tmp',
        platform: 'linux',
        shell: 'bash',
        agentProfiles: profiles,
      });

      expect(prompt).not.toContain('Available Subagents');
    });

    it('should inject Available Subagents when at least one agent is enabled', () => {
      const profiles: AgentProfile[] = [
        { name: 'enabled-agent', description: 'I am enabled', disabled: false },
        { name: 'disabled-agent', description: 'I am disabled', disabled: true },
      ];

      const prompt = buildSystemPrompt({
        cwd: '/tmp',
        platform: 'linux',
        shell: 'bash',
        agentProfiles: profiles,
      });

      expect(prompt).toContain('Available Subagents');
    });

    it('should not inject Available Subagents when no profiles provided', () => {
      const prompt = buildSystemPrompt({ cwd: '/tmp', platform: 'linux', shell: 'bash' });

      expect(prompt).not.toContain('Available Subagents');
    });

    it('should not inject Available Subagents when subagent switch is off (empty profiles)', () => {
      // Simulates agent.ts logic: when resolveSubagentEnabled is false, agentProfiles = []
      const prompt = buildSystemPrompt({
        cwd: '/tmp',
        platform: 'linux',
        shell: 'bash',
        agentProfiles: [],
      });

      expect(prompt).not.toContain('Available Subagents');
    });

    it('should filter out resolveAgentDisabled agents from system prompt', () => {
      // Simulates agent.ts logic: allAgentProfiles.filter(p => !resolveAgentDisabled(projectPath, p.name))
      const allProfiles: AgentProfile[] = [
        { name: 'agent-a', description: 'Agent A' },
        { name: 'agent-b', description: 'Agent B' },
      ];
      // Simulate agent-b being disabled via resolveAgentDisabled
      const filteredProfiles = allProfiles.filter((p) => p.name !== 'agent-b');

      const prompt = buildSystemPrompt({
        cwd: '/tmp',
        platform: 'linux',
        shell: 'bash',
        agentProfiles: filteredProfiles,
      });

      expect(prompt).toContain('agent-a');
      expect(prompt).not.toContain('agent-b');
    });
  });
});

describe('Project-level subagent enabled state', () => {
  beforeEach(() => {
    // 创建临时项目目录
    mkdirSync(join(TMP_PROJECT, '.codingcode'), { recursive: true });
    // 确保全局开关为 true
    setSubagentEnabledState(true);
  });

  afterEach(() => {
    // 清理临时目录
    rmSync(TMP_PROJECT, { recursive: true, force: true });
    setSubagentEnabledState(true);
  });

  it('should return undefined when project has no config', () => {
    expect(getProjectSubagentEnabledState(TMP_PROJECT)).toBe(undefined);
  });

  it('should persist project-level enabled state', () => {
    setProjectSubagentEnabledState(TMP_PROJECT, false);
    expect(getProjectSubagentEnabledState(TMP_PROJECT)).toBe(false);
  });

  it('should persist project-level enabled=true state', () => {
    setProjectSubagentEnabledState(TMP_PROJECT, false);
    setProjectSubagentEnabledState(TMP_PROJECT, true);
    expect(getProjectSubagentEnabledState(TMP_PROJECT)).toBe(true);
  });

  it('should reset project-level state to undefined', () => {
    setProjectSubagentEnabledState(TMP_PROJECT, false);
    resetProjectSubagentEnabledState(TMP_PROJECT);
    expect(getProjectSubagentEnabledState(TMP_PROJECT)).toBe(undefined);
  });

  it('resolveSubagentEnabled should use project-level when set', () => {
    setSubagentEnabledState(true); // 全局开启
    setProjectSubagentEnabledState(TMP_PROJECT, false); // 项目级关闭
    expect(resolveSubagentEnabled(TMP_PROJECT)).toBe(false);
  });

  it('resolveSubagentEnabled should fall back to global when project not set', () => {
    setSubagentEnabledState(false); // 全局关闭
    // 项目级未设置
    expect(resolveSubagentEnabled(TMP_PROJECT)).toBe(false);
  });

  it('resolveSubagentEnabled should use global when project config does not exist', () => {
    setSubagentEnabledState(true);
    const noConfigProject = join(__dirname, '__no_config__');
    try {
      mkdirSync(noConfigProject, { recursive: true });
      expect(resolveSubagentEnabled(noConfigProject)).toBe(true);
    } finally {
      rmSync(noConfigProject, { recursive: true, force: true });
    }
  });
});

describe('Global agent disabled state', () => {
  const testAgent = '__test_global_agent__';

  afterEach(() => {
    // 清理：重置全局 disabled 状态
    setGlobalAgentDisabledState(testAgent, false);
  });

  it('should default to not disabled', () => {
    expect(getGlobalAgentDisabledState(testAgent)).toBe(false);
  });

  it('should persist disabled state', () => {
    setGlobalAgentDisabledState(testAgent, true);
    expect(getGlobalAgentDisabledState(testAgent)).toBe(true);
  });

  it('should persist re-enabled state', () => {
    setGlobalAgentDisabledState(testAgent, true);
    setGlobalAgentDisabledState(testAgent, false);
    expect(getGlobalAgentDisabledState(testAgent)).toBe(false);
  });
});

describe('Project-level agent disabled state', () => {
  const testAgent = '__test_project_agent__';

  beforeEach(() => {
    mkdirSync(join(TMP_PROJECT, '.codingcode'), { recursive: true });
    setGlobalAgentDisabledState(testAgent, false);
  });

  afterEach(() => {
    rmSync(TMP_PROJECT, { recursive: true, force: true });
    setGlobalAgentDisabledState(testAgent, false);
  });

  it('should return undefined when project has no config', () => {
    expect(getProjectAgentDisabledState(TMP_PROJECT, testAgent)).toBe(undefined);
  });

  it('should persist project-level disabled state', () => {
    setProjectAgentDisabledState(TMP_PROJECT, testAgent, true);
    expect(getProjectAgentDisabledState(TMP_PROJECT, testAgent)).toBe(true);
  });

  it('should reset project-level disabled state', () => {
    setProjectAgentDisabledState(TMP_PROJECT, testAgent, true);
    resetProjectAgentDisabledState(TMP_PROJECT, testAgent);
    expect(getProjectAgentDisabledState(TMP_PROJECT, testAgent)).toBe(undefined);
  });

  it('resolveAgentDisabled should use project-level when set', () => {
    setGlobalAgentDisabledState(testAgent, false); // 全局未禁用
    setProjectAgentDisabledState(TMP_PROJECT, testAgent, true); // 项目级禁用
    expect(resolveAgentDisabled(TMP_PROJECT, testAgent)).toBe(true);
  });

  it('resolveAgentDisabled should fall back to global when project not set', () => {
    setGlobalAgentDisabledState(testAgent, true); // 全局禁用
    // 项目级未设置
    expect(resolveAgentDisabled(TMP_PROJECT, testAgent)).toBe(true);
  });

  it('resolveAgentDisabled should use project-level enabled over global disabled', () => {
    setGlobalAgentDisabledState(testAgent, true); // 全局禁用
    setProjectAgentDisabledState(TMP_PROJECT, testAgent, false); // 项目级启用
    expect(resolveAgentDisabled(TMP_PROJECT, testAgent)).toBe(false);
  });

  it('resolveAgentDisabled should use global when project config does not exist', () => {
    setGlobalAgentDisabledState(testAgent, false);
    const noConfigProject = join(__dirname, '__no_config_agent__');
    try {
      mkdirSync(noConfigProject, { recursive: true });
      expect(resolveAgentDisabled(noConfigProject, testAgent)).toBe(false);
    } finally {
      rmSync(noConfigProject, { recursive: true, force: true });
    }
  });
});
