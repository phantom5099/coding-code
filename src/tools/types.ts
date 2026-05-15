import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  schema: Record<string, unknown>;
  execute: (args: unknown, signal?: AbortSignal) => Promise<string>;
}

export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
