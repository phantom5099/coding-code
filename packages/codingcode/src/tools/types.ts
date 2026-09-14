import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
import type { ToolExecCtx } from '../contracts/tool.js';

export interface ToolDefinition<R = never> {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}
