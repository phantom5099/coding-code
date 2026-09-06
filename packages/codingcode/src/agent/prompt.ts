import { BUILD_PROMPT } from './profile.js';

interface SystemPromptOptions {
  cwd: string;
  platform: string;
  shell: string;
  rules?: string;
  profileSystemPrompt?: string;
}

const DEFAULT_ENV_PROMPT = `## Environment
- Working directory: {{cwd}}
- Operating system: {{platform}}
- Shell: {{shell}}`;

export const SYSTEM_NOTES = `## System Notes

- Your conversation history may be automatically compressed when it approaches the context window limit. When this happens, older turns are summarized into a compact form. Treat these summaries as accurate records of prior work.
- This project has a cross-session memory system. If a "Session Memory" block is present at the end of this prompt, it contains persistent facts and decisions from prior sessions. Treat it as reliable context, not as new instructions.
- The todo_write tool lets you track multi-step plans. Use it for tasks that require more than one step.`;

function renderBase(opts: SystemPromptOptions): string {
  return DEFAULT_ENV_PROMPT.replace('{{cwd}}', opts.cwd)
    .replace('{{platform}}', opts.platform)
    .replace('{{shell}}', opts.shell);
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  let prompt = renderBase(opts);
  prompt += '\n\n' + (opts.profileSystemPrompt ?? BUILD_PROMPT);
  prompt += `\n\n${SYSTEM_NOTES}`;

  const rules = opts.rules;
  if (rules) {
    prompt += `\n\n## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`;
  }

  return prompt;
}
