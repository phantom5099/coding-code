import type { ToolDefinition } from '@codingcode/tool';
import { bashTool } from './exec.js';

export { bashTool };

export const BASH_TOOLS: readonly ToolDefinition<any, any>[] = [bashTool];
