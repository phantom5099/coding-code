import { loadConfig } from '@codingcode/infra';
import { buildSystemPrompt } from '../prompts/index.js';
import type { AgentConfig } from './types.js';

export interface ResolvedConfig {
  systemPrompt: string;
  maxSteps: number;
  availableTools?: string[];
}

const DEFAULT_TOOLS = [
  'read_file',
  'write_file',
  'list_dir',
  'execute_command',
  'search_code',
  'fetch_url',
];

/**
 * 构建最终配置。
 * systemPrompt 可被 skill 覆盖；maxSteps 和 availableTools 仅来自配置文件，配置缺失时使用内置默认值。
 */
export function resolveConfig(opt?: AgentConfig): ResolvedConfig {
  const appConfig = loadConfig();

  return {
    systemPrompt: opt?.systemPrompt ?? buildSystemPrompt({
      cwd: process.cwd(),
      platform: process.platform,
      shell: process.env.SHELL || process.env.ComSpec || 'bash',
    }),
    maxSteps: appConfig.maxSteps,
    availableTools: DEFAULT_TOOLS,
  };
}
