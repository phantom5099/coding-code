import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Cause } from 'effect';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { submitPlanTool } from '../../src/tools/domains/subagent/submit-plan';
import { AgentError } from '../../src/core/error';
import { getPlanFilePath } from '../../src/config/plan-config';

// Use the OS temp dir so a crashed/interrupted test run never leaves artifacts
// in the project workspace root.
const TEST_DIR = join(tmpdir(), 'codingcode-test-submit-plan');

describe('submitPlanTool', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('has the canonical name and shape expected by the plan-mode approval pipeline', () => {
    expect(submitPlanTool.name).toBe('submit_plan');
    // The schema exposes plan_content as the only argument — this is what
    // the plan-approval system hook reads to populate the modal payload.
    expect(submitPlanTool.parameters).toBeDefined();
  });

  it('persists the plan content to the per-session plan file under the project plan dir', async () => {
    const sessionId = 'sess-001';
    const planContent = '# My Plan\n\n- step 1\n- step 2';

    const result = await Effect.runPromise(
      submitPlanTool.execute(
        { plan_content: planContent },
        { projectPath: TEST_DIR, sessionId } as any
      )
    );

    // The tool returns a "Plan written to <path>" envelope that the
    // afterPlanSubmitted observer matches on to switch into build mode.
    expect(result).toMatch(/^Plan written to /);
    const writtenPath = result.replace(/^Plan written to /, '');
    expect(writtenPath).toBe(getPlanFilePath(TEST_DIR, sessionId));
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toBe(planContent);
  });

  it('overwrites the plan file on subsequent calls (no history retained)', async () => {
    const sessionId = 'sess-002';
    const ctx = { projectPath: TEST_DIR, sessionId } as any;

    await Effect.runPromise(
      submitPlanTool.execute({ plan_content: 'first version' }, ctx)
    );
    await Effect.runPromise(
      submitPlanTool.execute({ plan_content: 'second version' }, ctx)
    );

    const planPath = getPlanFilePath(TEST_DIR, sessionId);
    expect(readFileSync(planPath, 'utf8')).toBe('second version');
  });

  it('fails with TOOL_EXECUTION_FAILED when projectPath is missing from the tool context', async () => {
    const result = await Effect.runPromiseExit(
      submitPlanTool.execute(
        { plan_content: 'x' },
        { sessionId: 's' } as any
      )
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      // Use Cause.failureOption to safely extract the original error.
      const failureOption = Cause.failureOption(result.cause);
      expect(failureOption._tag).toBe('Some');
      if (failureOption._tag === 'Some') {
        const failure = failureOption.value as AgentError;
        expect(failure).toBeInstanceOf(AgentError);
        expect(failure.code).toBe('TOOL_EXECUTION_FAILED');
        expect(failure.message).toMatch(/projectPath and sessionId/);
      }
    }
  });

  it('fails with TOOL_EXECUTION_FAILED when sessionId is missing from the tool context', async () => {
    const result = await Effect.runPromiseExit(
      submitPlanTool.execute(
        { plan_content: 'x' },
        { projectPath: TEST_DIR } as any
      )
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const failureOption = Cause.failureOption(result.cause);
      expect(failureOption._tag).toBe('Some');
      if (failureOption._tag === 'Some') {
        const failure = failureOption.value as AgentError;
        expect(failure).toBeInstanceOf(AgentError);
        expect(failure.code).toBe('TOOL_EXECUTION_FAILED');
      }
    }
  });
});
