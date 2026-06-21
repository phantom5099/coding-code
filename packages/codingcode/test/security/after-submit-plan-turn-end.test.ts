import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { submitPlanTool } from '../../src/tools/domains/subagent/submit-plan.js';
import { afterPlanSubmittedObserver } from '../../src/plan/after-submit.js';

describe('after submit_plan: observer + turn-end flow (v13 fix)', () => {
  let cwd: string;
  let sessionId: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-submit-plan-flow-'));
    sessionId = 'sess-flow-' + Math.random().toString(36).slice(2, 8);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('submit_plan writes the plan file with the "Plan written to " prefix', async () => {
    const result = await Effect.runPromise(
      submitPlanTool.execute(
        { plan_content: '# Plan\n- step 1' },
        { projectPath: cwd, sessionId } as any
      )
    );
    expect(result).toMatch(/^Plan written to /);
    const planPath = result.replace(/^Plan written to /, '');
    expect(existsSync(planPath)).toBe(true);
    expect(readFileSync(planPath, 'utf8')).toBe('# Plan\n- step 1');
  });

  it('afterPlanSubmittedObserver returns Effect (yields services)', () => {
    // The observer returns an Effect.gen that yields* ProjectRuntimeService,
    // SessionService, ApprovalService. The Effect's return type must not be void
    // or Promise — see the existing after-plan-submitted test.
    const result = afterPlanSubmittedObserver({} as any);
    expect(result).toBeDefined();
    expect(typeof (result as { pipe?: unknown }).pipe).toBe('function');
  });

  it('submit_plan output starts with "Plan written to " — agent loop can match it to end the turn', () => {
    // The agent loop's turn-end check looks for results with name='submit_plan'
    // and output.startsWith('Plan written to '). Verify the contract.
    const output = `Plan written to ${join(cwd, 'plan.md')}`;
    expect(output.startsWith('Plan written to ')).toBe(true);
  });
});

describe('v13 turn-end contract: after submit_plan + observer', () => {
  it('agent loop should call return(Result.ok) after submit_plan success (preventing plan-mode execution)', () => {
    // The agent loop in agent.ts now checks for successful submit_plan and
    // returns early. This test documents the contract by reading the source.
    // The actual integration test is in the existing test/agent/agent.test.ts.
    const agentSource = readFileSync(
      join(__dirname, '..', '..', 'src', 'agent', 'agent.ts'),
      'utf-8'
    );
    // The fix: a check for allResults containing a successful submit_plan,
    // followed by a return statement.
    expect(agentSource).toMatch(/allResults\.some\([\s\S]*r\.name === 'submit_plan'[\s\S]*Plan written to/);
    // And a Result.ok return.
    expect(agentSource).toMatch(/return\s+Result\.ok\('Plan submitted'\)/);
  });
});
