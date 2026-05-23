import { z } from 'zod';
export type { ToolDescription } from '../core/types';

export interface ToolExecCtx {
  signal?: AbortSignal;
  agentId?: string;
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
  execute: (args: unknown, ctx?: ToolExecCtx) => Promise<string>;
}
