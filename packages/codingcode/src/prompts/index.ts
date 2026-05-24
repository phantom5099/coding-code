import { getAllRules } from '../rules/index.js';

export const DEFERRED_TOOLS_GUIDELINES = `## Deferred tools
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
8. For complex or broad tasks (understanding a whole module, cross-file analysis, comprehensive search), delegate to dispatch_agent immediately with the original task — do not explore the topic yourself before delegating.

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
  skillInstruction?: string;
}

function renderBase(opts: SystemPromptOptions): string {
  return DEFAULT_SYSTEM_PROMPT
    .replace('{{cwd}}', opts.cwd)
    .replace('{{platform}}', opts.platform)
    .replace('{{shell}}', opts.shell);
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const variant = opts.variant ?? 'default';

  let prompt = renderBase(opts);
  if (variant === 'default') prompt += `\n\n${DEFERRED_TOOLS_GUIDELINES}`;

  const rules = getAllRules();
  if (rules) {
    prompt += `\n\n## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`;
  }

  if (opts.skillInstruction) {
    prompt += `\n\n## Skill Instructions\n\n${opts.skillInstruction}`;
  }

  return prompt;
}

