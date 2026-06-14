import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
export type { ToolDescription } from '../core/types.js';

export interface ToolExecCtx {
  signal?: AbortSignal;
  sessionId?: string;
  turnId?: number;
  projectPath?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  shortDescription?: string;
  deferred?: boolean;
  parameters: z.ZodTypeAny;
  /** Optional JSON Schema override. When absent, the schema is auto-generated from `parameters`. */
  jsonSchema?: Record<string, unknown>;
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, never>;
}

export interface ToolVisibilityPolicy {
  allowedTools?: Set<string>;
  allowedMcpServers?: Set<string>;
  allowToolSearch?: boolean;
  allowDeferredTools?: boolean;
}
