import { Effect } from 'effect';

export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
}

export class SubagentRegistry extends Effect.Service<SubagentRegistry>()('SubagentRegistry', {
  effect: Effect.gen(function* () {
    const map = new Map<string, SubagentProfile>();

    return {
      register: (profile: SubagentProfile): void => {
        map.set(profile.name, profile);
      },

      get: (name: string): SubagentProfile | undefined => {
        return map.get(name);
      },

      list: (): SubagentProfile[] => {
        return Array.from(map.values());
      },

      reset: (): void => {
        map.clear();
      },
    };
  }),
}) {}

export const EXPLORE_PROFILE: SubagentProfile = {
  name: 'explore',
  description: 'Read-only code exploration: searching files, reading symbols, understanding structure. No writes.',
  systemPrompt: 'You are a read-only code exploration agent. Your role is to help explore and understand codebases through reading files, searching for symbols, and analyzing code structure. You can only read; you cannot write or modify files.',
  tools: ['read_file', 'glob', 'search_code', 'web_fetch', 'tool_search'],
  readonly: true,
  maxSteps: 30,
};

export const GENERAL_PROFILE: SubagentProfile = {
  name: 'general',
  description: 'General purpose agent with read-only access to all tools. Useful for analysis, exploration, and non-destructive operations.',
  systemPrompt: 'You are a general purpose agent with read-only access to all available tools. You can analyze code, read files, search for patterns, and provide insights, but cannot modify files.',
  readonly: true,
  maxSteps: 40,
};
