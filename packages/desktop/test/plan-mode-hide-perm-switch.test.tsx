import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('Desktop: hide permission switcher in plan mode', () => {
  const agentWorkspaceSource = sourceContent('agent/AgentWorkspace.tsx');

  it('derives isPlanMode from the agent store', () => {
    expect(agentWorkspaceSource).toMatch(/isPlanMode/);
    expect(agentWorkspaceSource).toMatch(
      /modeByThreadId\[s\.currentThreadId\]\?\.mode\s*===\s*['"]plan['"]/
    );
  });

  it('does not fetch session mode on session switch (no useAgentMode in AgentWorkspace)', () => {
    expect(agentWorkspaceSource).not.toMatch(/useAgentMode\(\)/);
    expect(agentWorkspaceSource).not.toMatch(/fetchSessionMode/);
  });

  it('gates the permission switcher button behind !isPlanMode', () => {
    const blockMatches = [/\{!isPlanMode\s*&&/];
    const hasGate = blockMatches.some((re) => re.test(agentWorkspaceSource));
    expect(hasGate).toBe(true);
  });

  it('does NOT silently remove the switcher for build sessions (still rendered)', () => {
    expect(agentWorkspaceSource).toContain('POLICY_NEXT[approvalPolicy]');
    expect(agentWorkspaceSource).toContain("POLICY_LABELS[approvalPolicy] ?? '全部询问'");
  });
});
