import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('Desktop: hide permission switcher in plan profile', () => {
  const agentWorkspaceSource = sourceContent('agent/AgentWorkspace.tsx');

  it('derives isPlanProfile from the agent store', () => {
    expect(agentWorkspaceSource).toMatch(/isPlanProfile/);
    expect(agentWorkspaceSource).toMatch(
      /profileByThreadId\[s\.currentThreadId\]\?\.activeProfile\s*===\s*['"]plan['"]/
    );
  });

  it('does not fetch session profile on session switch (no useAgentProfile in AgentWorkspace)', () => {
    expect(agentWorkspaceSource).not.toMatch(/useAgentProfile\(\)/);
    expect(agentWorkspaceSource).not.toMatch(/fetchSessionProfile/);
  });

  it('gates the permission switcher button behind !isPlanProfile', () => {
    const blockMatches = [/\{!isPlanProfile\s*&&/];
    const hasGate = blockMatches.some((re) => re.test(agentWorkspaceSource));
    expect(hasGate).toBe(true);
  });

  it('does NOT silently remove the switcher for build sessions (still rendered)', () => {
    expect(agentWorkspaceSource).toContain('POLICY_NEXT[approvalPolicy]');
    expect(agentWorkspaceSource).toContain("POLICY_LABELS[approvalPolicy] ?? '全部询问'");
  });
});
