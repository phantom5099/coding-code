import { describe, it, expect } from 'vitest';
import { planApprovalHook } from '../../src/plan/index.js';

describe('planApprovalHook', () => {
  it('returns null for tools other than submit_plan', () => {
    expect(
      planApprovalHook({ toolName: 'write_file', args: { path: '/x' }, sessionId: 's' } as any)
    ).toBeNull();
    expect(
      planApprovalHook({ toolName: 'edit_file', args: { path: '/x' }, sessionId: 's' } as any)
    ).toBeNull();
  });

  it('returns null for submit_plan without plan_content', () => {
    expect(planApprovalHook({ toolName: 'submit_plan', args: {}, sessionId: 's' } as any)).toBeNull();
  });

  it('asks for user confirmation and forwards plan_content in the payload', () => {
    const planContent = '# plan\n\nbody';
    const result = planApprovalHook({
      toolName: 'submit_plan',
      args: { plan_content: planContent },
      sessionId: 'sess-x',
      projectPath: '/proj',
    } as any);

    expect(result).not.toBeNull();
    expect(result?.decision).toBe('ask');
    expect(result?.reason).toBe('plan_approval_required');
    // Payload is what the UI reads to render the modal without a second
    // round-trip to the plan file.
    expect(result?.payload).toMatchObject({
      plan_content: planContent,
      session_id: 'sess-x',
      project_path: '/proj',
    });
  });
});
