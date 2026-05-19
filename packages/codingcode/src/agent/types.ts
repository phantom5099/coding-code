export interface AgentConfig {
  systemPrompt?: string;
}

export interface LoopState {
  step: number;
  maxSteps: number;
}

export type { AgentEvent } from '../bus/types.js';
