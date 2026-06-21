import { z } from 'zod';
import { Effect } from 'effect';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';
import { encodeProjectPath, getProjectPlansBaseDir } from '../../../core/path.js';
import { PlanApprovalService } from '../../../plan/approval-service.js';
import type { PlanConfirmResult } from '../../../plan/plan-confirm.js';

export const submitPlanTool: ToolDefinition = {
  name: 'submit_plan',
  description:
    'Submit (or update) the implementation plan for the current session. The only write operation allowed in plan mode. Each call overwrites the plan file.',
  shortDescription: 'Submit plan',
  parameters: z.object({
    plan_content: z
      .string()
      .min(1)
      .describe(
        'Full Markdown implementation plan, including Current state / Key files / Risks / Approach / Phases.'
      ),
  }),
  execute: (args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError> =>
    Effect.gen(function* () {
      const { plan_content: initialContent } = args as { plan_content: string };
      const projectPath = ctx?.projectPath;
      const sessionId = ctx?.sessionId;
      if (!projectPath || !sessionId) {
        return yield* Effect.fail(
          new AgentError(
            'TOOL_EXECUTION_FAILED',
            'submit_plan requires projectPath and sessionId in tool context'
          )
        );
      }

      const planDir = join(getProjectPlansBaseDir(), encodeProjectPath(projectPath));
      const planPath = join(planDir, `${sessionId}.md`);

      const planService = yield* PlanApprovalService;
      const decision: PlanConfirmResult = yield* planService.requestPlanDecision({
        sessionId,
        projectPath,
        planContent: initialContent,
        planPath,
      });

      if (decision.type === 'canceled') {
        return yield* Effect.fail(
          new AgentError('TOOL_NOT_ALLOWED', 'User canceled plan approval')
        );
      }

      const finalContent =
        decision.type === 'modified' &&
        typeof decision.input === 'object' &&
        decision.input !== null
          ? String(
              (decision.input as { plan_content?: string }).plan_content ?? initialContent
            )
          : initialContent;

      try {
        mkdirSync(planDir, { recursive: true });
        writeFileSync(planPath, finalContent, 'utf8');
        return `Plan written to ${planPath}`;
      } catch (err) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', `Failed to write plan: ${String(err)}`)
        );
      }
    }) as Effect.Effect<string, AgentError>,
};
