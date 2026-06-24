import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('Desktop: InputBox "查看计划" button', () => {
  const agentWorkspaceSource = sourceContent('agent/AgentWorkspace.tsx');

  it('imports FileText from lucide-react', () => {
    expect(agentWorkspaceSource).toMatch(/FileText.*from\s+['"]lucide-react['"]/);
  });

  it('derives planExists from the agent store', () => {
    expect(agentWorkspaceSource).toMatch(/planExists/);
    expect(agentWorkspaceSource).toMatch(/pendingPlanByThreadId\[s\.currentThreadId\]\s*!=\s*null/);
  });

  it('does not call useAgentMode in AgentWorkspace', () => {
    expect(agentWorkspaceSource).not.toMatch(/useAgentMode\(\)/);
  });

  it('renders the view-plan button only when planExists is true', () => {
    expect(agentWorkspaceSource).toMatch(/\{planExists\s*&&\s*onOpenPlanPanel\s*\&\&\s*\(/);
  });

  it('button calls onOpenPlanPanel on click', () => {
    const viewPlanButtonMatch =
      agentWorkspaceSource.match(
        /onClick=\{onOpenPlanPanel\}[\s\S]{0,300}data-testid="view-plan-button"/
      ) ||
      agentWorkspaceSource.match(
        /data-testid="view-plan-button"[\s\S]{0,300}onClick=\{onOpenPlanPanel\}/
      );
    expect(viewPlanButtonMatch).not.toBeNull();
  });

  it('button has a visible label "查看计划"', () => {
    expect(agentWorkspaceSource).toContain('查看计划');
  });

  it('does NOT call onOpenPlanPanel unconditionally (gating is required)', () => {
    expect(agentWorkspaceSource).toMatch(/planExists\s*&&\s*onOpenPlanPanel/);
  });
});
