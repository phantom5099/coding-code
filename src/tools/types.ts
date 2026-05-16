import { z } from 'zod';

export type { ToolDescription } from '../core/types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  schema: Record<string, unknown>;
  execute: (args: unknown, signal?: AbortSignal) => Promise<string>;
}
