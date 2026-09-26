import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
import type { ToolExecCtx } from '../contracts/tool.js';

export interface ToolDefinition<R = never> {
  name: string;
  /** 是否可与同批其它工具并发；省略即 false（fail-closed） */
  concurrencySafe?: boolean;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}
