import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const PERMISSION_MODES = ['askBeforeExec', 'bypass'] as const;

describe('权限模式：直接使用服务端 PermissionMode，未创建会话时取 config.yaml', () => {
  const workspace = sourceContent('agent/AgentWorkspace.tsx');
  const store = sourceContent('stores/agent.store.ts');
  const indicator = sourceContent('agent/ProfileIndicator.tsx');
  const useAgent = sourceContent('hooks/useAgent.ts');
  const coreApi = sourceContent('lib/core-api.ts');

  it('工具栏只保留与服务端一致的两个档位', () => {
    for (const mode of PERMISSION_MODES) {
      expect(workspace).toContain(mode);
    }
    // 原先那套四值 UI 枚举已删除（其中"只读"与服务端 ask 等价，是空操作）
    expect(workspace).not.toContain('ask-all');
    expect(workspace).not.toContain('smart-allow');
    expect(workspace).not.toContain('full-allow');
    expect(workspace).not.toContain('read-only');
  });

  it('循环切换只在两个档位之间', () => {
    const cycle = workspace.match(/const MODE_NEXT[\s\S]*?\n\};/)?.[0] ?? '';
    expect(cycle).toContain("askBeforeExec: 'bypass'");
    expect(cycle).toContain("bypass: 'askBeforeExec'");
  });

  it('展示名：askBeforeExec 为「执行前询问」，bypass 为「完全放行」', () => {
    const labels = workspace.match(/const MODE_LABELS[\s\S]*?\n\};/)?.[0] ?? '';
    expect(labels).toContain("askBeforeExec: '执行前询问'");
    expect(labels).toContain("bypass: '完全放行'");
  });

  it('整个 src 里不再出现已删除的档位名', () => {
    const offenders = walk(resolve(__dirname, '..', 'src')).filter((f) =>
      /acceptEdits/.test(readFileSync(f, 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  it('无会话时写 config.yaml，有会话时写该会话', () => {
    expect(workspace).toContain('setAgentConfig({ permissionMode: next })');
    expect(workspace).toContain('setSessionPermissionMode(currentThreadId');
  });

  it('有会话时展示该会话真实的权限模式，而不是全局单值', () => {
    expect(workspace).toContain('profileByThreadId[s.currentThreadId]?.permissionMode');
  });

  it('agent.store 用 profile / permissionMode 镜像 config.yaml，不再自造 defaults 概念', () => {
    expect(store).not.toContain('approvalPolicy');
    expect(store).not.toContain('pendingProfile');
    expect(store).not.toContain('sessionDefaults');
    expect(store).toContain('profile: ProfileName');
    expect(store).toContain('permissionMode: PermissionMode');
  });

  it('agent.store 不再挂 persist（无字段需要落盘）', () => {
    expect(store).not.toContain('import { persist');
    expect(store).not.toContain('createJSONStorage');
    expect(store).not.toContain('partialize');
  });

  it('建会话的默认模式来自服务端 agent 配置，而不是本地枚举映射', () => {
    expect(useAgent).not.toContain('APPROVAL_POLICY_TO_PERMISSION_MODE');
    expect(useAgent).not.toContain('sessionDefaults');
    expect(useAgent).toContain('s.profile');
    expect(useAgent).toContain('fetchAgentConfig');
  });

  it('ProfileIndicator 无会话分支把改动回写服务端', () => {
    expect(indicator).toContain('setAgentConfig({ activeProfile: target })');
    expect(indicator).not.toContain('pendingProfile');
  });

  it('整个 src 里不再残留四值枚举，也不再出现 sessionDefaults', () => {
    const offenders = walk(resolve(__dirname, '..', 'src')).filter((f) =>
      /ask-all|smart-allow|full-allow|sessionDefaults/.test(readFileSync(f, 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  it('默认模式的读写都走 config.yaml（经 agent 配置通道）', () => {
    expect(coreApi).toContain('clients.settings.getAgentConfig');
    expect(coreApi).toContain('clients.settings.setAgentConfig');
  });
});
