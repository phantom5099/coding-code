import { z } from 'zod';
export type { ToolDescription } from '../core/types';

export interface ToolExecCtx {
  signal?: AbortSignal;
  sessionId?: string;
  turnId?: number;
  projectPath?: string;
  agentRunner?: {
    agentService: any; // AgentService — use any to avoid circular imports
    llm: any; // LLMClient — use any to avoid circular imports
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  shortDescription?: string;
  deferred?: boolean;
  parameters: z.ZodTypeAny;
  /** Optional JSON Schema override. When absent, the schema is auto-generated from `parameters`. */
  jsonSchema?: Record<string, unknown>;
  execute: (args: unknown, ctx?: ToolExecCtx) => Promise<string>;
}

export interface ToolVisibilityPolicy {
  allowedTools?: Set<string>;
  allowedMcpServers?: Set<string>;
  allowToolSearch?: boolean;
  allowDeferredTools?: boolean;
}
