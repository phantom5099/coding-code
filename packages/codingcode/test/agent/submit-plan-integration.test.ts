import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { submitPlanTool } from '../../src/tools/domains/subagent/submit-plan.js';
import { PLAN_PROFILE, BUILD_PROFILE } from '../../src/subagent/registry.js';
import { getBuiltinTools } from '../../src/tools/providers.js';
import { TodoService } from '../../src/agent/todo.js';
import { PlanApprovalService } from '../../src/plan/approval-service.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

const mockTodoService = {
  read: () => [],
  write: () => undefined,
  clear: () => undefined,
} as any;

const mockPlanApprovalService = {
  requestPlanDecision: () => Effect.succeed({ type: 'allow' as const }) as any,
  resolvePlanDecision: () => Effect.succeed(false),
  getPending: () => Effect.succeed([]),
  registerEmitter: () => Effect.succeed(undefined),
  unregisterEmitter: () => Effect.succeed(undefined),
  hasEmitter: () => Effect.succeed(false),
} as any;

const TodoTestLayer = Layer.succeed(TodoService, mockTodoService);
const PlanTestLayer = Layer.succeed(PlanApprovalService, mockPlanApprovalService);
const TestLayer = Layer.mergeAll(TodoTestLayer, PlanTestLayer);

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('submit_plan tool integration', () => {
  let cwd: string;
  let sessionId: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'codingcode-tool-int-test-'));
    sessionId = 'sess-tool-int';
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('writes the plan file at the expected path under the project plan directory', async () => {
    const result = await runWithLayer(
      submitPlanTool.execute({ plan_content: '# Plan v1\n- step 1' }, {
        projectPath: cwd,
        sessionId,
      } as any)
    );
    expect(result).toMatch(/^Plan written to /);

    const planPath = result.replace(/^Plan written to /, '');
    expect(existsSync(planPath)).toBe(true);
    expect(readFileSync(planPath, 'utf8')).toBe('# Plan v1\n- step 1');
  });

  it('overwrites the plan file on each call (no history)', async () => {
    const firstResult = await runWithLayer(
      submitPlanTool.execute({ plan_content: 'v1' }, { projectPath: cwd, sessionId } as any)
    );
    const secondResult = await runWithLayer(
      submitPlanTool.execute({ plan_content: 'v2' }, { projectPath: cwd, sessionId } as any)
    );
    // The path is determined by ~/.codingcode/projects/<encodedCwd>/<sessionId>.md.
    // We derive it from the first execute's return envelope so this test does
    // not depend on the exact home-directory layout.
    const planPath = firstResult.replace(/^Plan written to /, '');
    expect(secondResult).toMatch(new RegExp(`${planPath.replaceAll('\\', '\\\\')}$`));
    expect(readFileSync(planPath, 'utf8')).toBe('v2');
  });

  it('returns output starting with "Plan written to" — afterPlanSubmitted observer matches on this', async () => {
    const result = await runWithLayer(
      submitPlanTool.execute({ plan_content: 'v1' }, { projectPath: cwd, sessionId } as any)
    );
    expect(result.startsWith('Plan written to ')).toBe(true);
  });

  it('submit_plan is NOT in the default builtin tools (conditional injection only)', async () => {
    const tools = await runWithLayer(getBuiltinTools());
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('submit_plan');
  });

  it('PLAN_PROFILE declares submit_plan in its tools list (filter compatibility)', () => {
    expect(PLAN_PROFILE.tools).toContain('submit_plan');
  });

  it('BUILD_PROFILE does NOT declare submit_plan in its tools list (defense in depth)', () => {
    expect(BUILD_PROFILE.tools).not.toContain('submit_plan');
  });
});
