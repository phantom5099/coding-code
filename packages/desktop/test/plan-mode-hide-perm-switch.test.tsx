import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('Desktop: hide permission switcher in plan mode', () => {
  const agentWorkspaceSource = sourceContent('agent/AgentWorkspace.tsx');

  it('imports useAgentMode hook for fetching the session mode', () => {
    expect(agentWorkspaceSource).toMatch(/import\s+\{[^}]*useAgentMode[^}]*\}\s+from\s+['"]\.\.\/hooks\/useAgent/);
  });

  it('tracks isPlanMode state and fetches it for the current session', () => {
    expect(agentWorkspaceSource).toMatch(/setIsPlanMode/);
    expect(agentWorkspaceSource).toMatch(/fetchSessionMode/);
    expect(agentWorkspaceSource).toMatch(/setIsPlanMode\(m\.profileName === ['"]plan['"]\)/);
  });

  it('gates the permission switcher button behind !isPlanMode', () => {
    // The button onClick that contains POLICY_TO_CORE_MODE must be inside a
    // {!isPlanMode && (...)} block.
    const blockMatches = [
      /\{!isPlanMode\s*&&/,
      /\{isPlanMode\s*\?\s*null\s*:/,
    ];
    const hasGate = blockMatches.some((re) => re.test(agentWorkspaceSource));
    expect(hasGate).toBe(true);
  });

  it('does NOT silently remove the switcher for build sessions (still rendered)', () => {
    // The button text and onClick should still exist in source.
    expect(agentWorkspaceSource).toContain('POLICY_NEXT[approvalPolicy]');
    expect(agentWorkspaceSource).toContain("POLICY_LABELS[approvalPolicy] ?? '全部询问'");
  });
});
