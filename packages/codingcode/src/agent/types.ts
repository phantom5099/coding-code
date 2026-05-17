import type { ToolDescription } from '../tools/types.js';

export interface AgentConfig {
  role: string;
  model?: string;
  maxSteps?: number;
  systemPrompt?: string;
  availableTools?: string[];
}

export interface LoopState {
  step: number;
  maxSteps: number;
  lastToolCalls?: import('../core/types.js').ToolCall[];
}
