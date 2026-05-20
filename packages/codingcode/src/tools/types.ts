import { z } from 'zod';

export type { ToolDescription } from '../core/types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  /** Optional JSON Schema override. When absent, the schema is auto-generated from `parameters`. */
  jsonSchema?: Record<string, unknown>;
  execute: (args: unknown, signal?: AbortSignal) => Promise<string>;
}
