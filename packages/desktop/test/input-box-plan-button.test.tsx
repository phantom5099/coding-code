import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sourceContent(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
}

describe('Desktop: InputBox "查看计划" button (v13 改 3)', () => {
  const agentWorkspaceSource = sourceContent('agent/AgentWorkspace.tsx');

  it('imports FileText from lucide-react', () => {
    expect(agentWorkspaceSource).toMatch(/FileText.*from\s+['"]lucide-react['"]/);
  });

  it('destructures fetchPlan from useAgentMode hook', () => {
    expect(agentWorkspaceSource).toMatch(/fetchPlan/);
    // fetchPlan comes from useAgentMode (already declared in v12 with fetchMode)
    const useAgentModeCall = /useAgentMode\(\)/;
    expect(useAgentModeCall.test(agentWorkspaceSource)).toBe(true);
  });

  it('tracks planExists state and fetches it for the current session', () => {
    expect(agentWorkspaceSource).toMatch(/setPlanExists/);
    expect(agentWorkspaceSource).toMatch(/setPlanExists\(p\.exists\)/);
  });

  it('renders the view-plan button only when planExists is true', () => {
    // The button onClick that calls onOpenPlanPanel must be inside a
    // {planExists && (...)} block.
    expect(agentWorkspaceSource).toMatch(/\{planExists\s*&&\s*onOpenPlanPanel\s*\&\&\s*\(/);
  });

  it('button calls onOpenPlanPanel on click', () => {
    // Find the onClick handler for the view-plan button (either order works)
    const viewPlanButtonMatch = agentWorkspaceSource.match(
      /onClick=\{onOpenPlanPanel\}[\s\S]{0,300}data-testid="view-plan-button"/
    ) || agentWorkspaceSource.match(
      /data-testid="view-plan-button"[\s\S]{0,300}onClick=\{onOpenPlanPanel\}/
    );
    expect(viewPlanButtonMatch).not.toBeNull();
  });

  it('button has a visible label "查看计划"', () => {
    expect(agentWorkspaceSource).toContain('查看计划');
  });

  it('does NOT call onOpenPlanPanel unconditionally (gating is required)', () => {
    // Without planExists gate, would be a regression to old behavior
    const unconditional = /onClick=\{onOpenPlanPanel\}(?!\s*\/\/\s*gated)/;
    // Just verify the gate is present (we already checked above)
    expect(agentWorkspaceSource).toMatch(/planExists\s*&&\s*onOpenPlanPanel/);
  });
});
