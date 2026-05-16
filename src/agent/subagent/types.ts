import type { AgentConfig } from '../types';

export interface SubagentConfig extends AgentConfig {
  id: string;
  instruction: string;
  dependsOn?: string[];
}
