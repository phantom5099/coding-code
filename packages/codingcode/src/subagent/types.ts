export type AgentProfileName = 'plan' | 'build';

export interface AgentProfile {
  name: AgentProfileName;
  systemPrompt?: string;
  maxSteps?: number;
}
