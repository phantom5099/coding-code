import { z } from 'zod';
import { Effect } from 'effect';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';
import { encodeProjectPath, getProjectBaseDir } from '../../../core/path.js';
import { createLogger } from '@codingcode/infra/logger';

const logger = createLogger();

export function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^一-鿿぀-ヿa-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plan'
  );
}

function ensureH1(content: string, title: string): string {
  const firstLine = content.split('\n', 1)[0]?.trim() ?? '';
  if (/^#\s+/.test(firstLine)) return content;
  return `# ${title}\n\n${content}`;
}

function warnMissingSections(content: string): void {
  const has = (re: RegExp) => re.test(content);
  const missing: string[] = [];
  if (!has(/^#{1,3}\s*(Verification|验证)/im)) missing.push('Verification');
  if (!has(/^#{1,3}\s*(Out of scope|不在范围内|范围外)/im)) missing.push('Out of scope');
  if (missing.length > 0) {
    logger.warn(
      `submit_plan: plan is missing recommended section(s): ${missing.join(', ')}. ` +
        `See PLAN_PROFILE.systemPrompt for the required format.`
    );
  }
}

export const submitPlanTool: ToolDefinition = {
  name: 'submit_plan',
  description:
    'Submit (or update) the implementation plan for the current session. The only write operation allowed in plan mode. The file is written immediately and the tool returns synchronously; the user is then shown a plan approval modal in the UI. The user’s next message will contain their decision (implement / revised content / cancel).',
  shortDescription: 'Submit plan',
  parameters: z.object({
    title: z
      .string()
      .min(1)
      .max(80)
      .describe(
        'Short, human-readable title (max 80 chars). Becomes the filename. Must be in English. State the outcome, e.g. "Add OAuth login flow".'
      ),
    plan_content: z
      .string()
      .min(1)
      .describe(
        'Full Markdown implementation plan. Must contain the sections: Goal, Current state, Out of scope, Approach, Key files, Dependencies and risks, Verification. Phases is optional.'
      ),
  }),
  execute: (args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError> =>
    Effect.gen(function* () {
      const { title, plan_content: rawContent } = args as {
        title: string;
        plan_content: string;
      };
      const projectPath = ctx?.projectPath;
      const sessionId = ctx?.sessionId;
      if (!projectPath || !sessionId) {
        return yield* Effect.fail(
          new AgentError(
            'TOOL_EXECUTION_FAILED',
            'submit_plan requires projectPath, sessionId in tool context'
          )
        );
      }

      warnMissingSections(rawContent);
      const initialContent = ensureH1(rawContent, title);
      const planDir = join(getProjectBaseDir(), encodeProjectPath(projectPath));
      const initialPath = join(planDir, `${slug(title)}.md`);

      mkdirSync(planDir, { recursive: true });
      writeFileSync(initialPath, initialContent, 'utf8');

      return `Plan written to ${initialPath}`;
    }) as Effect.Effect<string, AgentError>,
};
