import { getAllRules } from '../rules/index.js';

export const TASK_TRACKING_GUIDELINES = `## Task tracking & deferred tools
- For multi-step work, use todo_write to record the plan and todo_read to check progress.
- Do not rely on memory for current todo state; call todo_read when uncertain.
- Some tools are listed as deferred — call tool_search with relevant keywords before using them.`;

const DEFAULT_SYSTEM_PROMPT = `You are a coding assistant — an AI agent that helps users write, read, search, and modify code.

## Rules
1. Read files before modifying them — never guess file contents
2. Use search_code to find where symbols are defined
3. After writing files, verify with read_file
4. Prefer editing existing files over creating new ones
5. Make small, focused changes — avoid large rewrites
6. Run tests or type-check after changes when applicable
7. If the user's request is ambiguous, ask for clarification

## Environment
- Working directory: {{cwd}}
- Operating system: {{platform}}
- Shell: {{shell}}

Respond in the user's language. Use code blocks for code.`;

export type SystemPromptVariant = 'default' | 'minimal';

export interface SystemPromptOptions {
  cwd: string;
  platform: string;
  shell: string;
  variant?: SystemPromptVariant;
  includeTaskTracking?: boolean;
}

function renderBase(opts: SystemPromptOptions): string {
  return DEFAULT_SYSTEM_PROMPT
    .replace('{{cwd}}', opts.cwd)
    .replace('{{platform}}', opts.platform)
    .replace('{{shell}}', opts.shell);
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const variant = opts.variant ?? 'default';
  const includeTaskTracking = opts.includeTaskTracking ?? (variant === 'default');

  let prompt = renderBase(opts);
  if (includeTaskTracking) prompt += `\n\n${TASK_TRACKING_GUIDELINES}`;

  const rules = getAllRules();
  if (rules) {
    prompt += `\n\n## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`;
  }
  return prompt;
}

export type { AgentRole, PromptSet } from "./types.js";
export { coderPromptSet } from "./coder.js";
export { debuggerPromptSet } from "./debugger.js";
export { reviewerPromptSet } from "./reviewer.js";
