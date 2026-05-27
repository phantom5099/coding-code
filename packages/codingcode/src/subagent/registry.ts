import { Effect } from 'effect';

export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
}

let _globalSubagentEnabled = true;
export function getSubagentEnabledState(): boolean { return _globalSubagentEnabled; }
export function setSubagentEnabledState(v: boolean): void { _globalSubagentEnabled = v; }

const _disabledAgents = new Set<string>();
export function setAgentDisabledState(name: string, disabled: boolean): void {
  if (disabled) _disabledAgents.add(name);
  else _disabledAgents.delete(name);
}
export function isAgentDisabledState(name: string): boolean {
  return _disabledAgents.has(name);
}

export class SubagentRegistry extends Effect.Service<SubagentRegistry>()('SubagentRegistry', {
  effect: Effect.gen(function* () {
    const map = new Map<string, SubagentProfile>();
    const disabledAgents = new Set<string>();

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
        _globalSubagentEnabled = true;
        disabledAgents.clear();
        _disabledAgents.clear();
      },

      setEnabled: (v: boolean): void => { _globalSubagentEnabled = v; },
      isEnabled: (): boolean => _globalSubagentEnabled,

      disableAgent: (name: string): void => { disabledAgents.add(name); _disabledAgents.add(name); },
      enableAgent: (name: string): void => { disabledAgents.delete(name); _disabledAgents.delete(name); },
      isAgentDisabled: (name: string): boolean => disabledAgents.has(name) || _disabledAgents.has(name),
    };
  }),
}) {}

export const EXPLORE_PROFILE: SubagentProfile = {
  name: 'explore',
  description: 'Read-only code exploration: searching files, reading symbols, understanding structure. No writes.',
  systemPrompt: 'You are a read-only code exploration agent. Your role is to help explore and understand codebases through reading files, searching for symbols, and analyzing code structure. You can only read; you cannot write or modify files.',
  tools: ['read_file', 'search_files', 'search_code', 'fetch_url', 'tool_search'],
  readonly: true,
  maxSteps: 30,
};

