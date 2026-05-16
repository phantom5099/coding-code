import type { LLMClient } from '../llm/client';
import type { ToolExecutor } from '../tools/executor';
import type { HookRegistry } from '../core/hooks';

export interface AgentConfig {
  role: string;
  model?: string;
  maxSteps?: number;
  systemPrompt?: string;
  availableTools?: string[];
  temperature?: number;
}

export interface AgentDeps {
  llm: LLMClient;
  executor: ToolExecutor;
  hooks: HookRegistry;
}

export interface LoopState {
  step: number;
  maxSteps: number;
  lastToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}
