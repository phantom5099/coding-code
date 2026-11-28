import type { ToolDefinition } from '@codingcode/tool';
import { webFetchTool } from './fetch.js';
import { webSearchTool, parseBingHtml, parseBaiduHtml } from './search.js';

export { webFetchTool, webSearchTool, parseBingHtml, parseBaiduHtml };

export const WEB_TOOLS: readonly ToolDefinition<any, any>[] = [webFetchTool, webSearchTool];
