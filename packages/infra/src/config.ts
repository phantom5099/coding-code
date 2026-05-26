import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ContextThresholdsConfig {
  budgetReduction: number;
  prune: number;
  compaction: number;
}

export interface ContextConfig {
  defaultMaxTokens: number;
  reservedTokens: number;
  thresholds: ContextThresholdsConfig;
  pruneProtectedTokens: number;
  pruneMinRelease: number;
  toolsExemptFromPrune: string[];
  prefixTurnsProtected: number;
  minTurnsBetweenCompactions: number;
  keepRecentTurns: number;
  /** Model for context compaction. Empty string falls back to main session LLM.
   *  Use full id format "model@API_KEY_ENV" to avoid ambiguity (e.g. "deepseek-chat@DEEPSEEK_API_KEY").
   *  Can also use bare model id (e.g. "deepseek-chat") or display name, first match wins. */
  compactionModel: string;
  archiveTtlDays: number;
  checkpointKeep: number;
  thresholdTokens: number;
  truncateKeepHeadLines: number;
  truncateKeepTailLines: number;
  persistPreviewChars: number;
  persistableTools: string[];
  reactiveCompactMaxRetries: number;
  reactiveCompactKeepTurns: number;
  snipMaxMessages: number;
  snipKeepHead: number;
  microKeepRecentTools: number;
}

export interface MemoryTypeConfig {
  name: string;
  description: string;
  enabled: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  /** Model for memory operations. Empty string falls back to main session LLM.
   *  Use full id format "model@API_KEY_ENV" to avoid ambiguity (e.g. "deepseek-chat@DEEPSEEK_API_KEY").
   *  Can also use bare model id (e.g. "deepseek-chat") or display name, first match wins. */
  model: string;
  projectFile: string;
  userFile: string;
  maxBytes: number;
  promptMaxBytes: number;
  extraTypes: MemoryTypeConfig[];
  disabledTypes: string[];
}

export interface ActiveModelConfig {
  model: string;
  apiKeyEnv: string;
}

export interface AppConfig {
  server: {
    port: number;
  };
  maxSteps: number;
  maxStopContinuations: number;
  activeModel?: ActiveModelConfig;
  context: ContextConfig;
  memory: MemoryConfig;
}

const DEFAULT_CONTEXT: ContextConfig = {
  defaultMaxTokens: 200000,
  reservedTokens: 20000,
  thresholds: { budgetReduction: 0.6, prune: 0.7, compaction: 0.9 },
  pruneProtectedTokens: 40000,
  pruneMinRelease: 20000,
  toolsExemptFromPrune: ['Read', 'todo_write', 'todo_read', 'tool_search'],
  prefixTurnsProtected: 1,
  minTurnsBetweenCompactions: 5,
  keepRecentTurns: 10,
  compactionModel: '',
  archiveTtlDays: 30,
  checkpointKeep: 50,
  thresholdTokens: 2000,
  truncateKeepHeadLines: 5,
  truncateKeepTailLines: 15,
  persistPreviewChars: 2000,
  persistableTools: ['execute_command', 'fetch_url'],
  reactiveCompactMaxRetries: 1,
  reactiveCompactKeepTurns: 3,
  snipMaxMessages: 100,
  snipKeepHead: 3,
  microKeepRecentTools: 5,
};

export const DEFAULT_MEMORY_TYPES: MemoryTypeConfig[] = [
  { name: 'user', description: '用户角色、技能栈、工作偏好及对 Agent 的纠正', enabled: true },
  { name: 'project', description: '架构决策、技术选型、部署信息', enabled: true },
  { name: 'reference', description: '外部资源、文档、Dashboard 链接', enabled: true },
];

export const DEFAULT_MEMORY: MemoryConfig = {
  enabled: false,
  model: '',
  projectFile: '.codingcode/memory.md',
  userFile: '~/.codingcode/memory.md',
  maxBytes: 16384,
  promptMaxBytes: 8192,
  extraTypes: [],
  disabledTypes: [],
};

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 50,
  maxStopContinuations: 2,
  context: DEFAULT_CONTEXT,
  memory: DEFAULT_MEMORY,
};

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key as keyof T];
    if (val !== undefined) {
      if (isObject(val) && isObject(result[key as keyof T])) {
        (result as any)[key] = deepMerge(result[key as keyof T] as any, val as any);
      } else {
        (result as any)[key] = val;
      }
    }
  }
  return result;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function updateActiveModel(model: string, apiKeyEnv: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  existing.activeModel = { model, apiKeyEnv };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function updateMemoryEnabled(enabled: boolean, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, enabled };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function updateMemoryDisabledTypes(disabledTypes: string[], configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, disabledTypes };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function updateMemoryExtraTypes(extraTypes: MemoryTypeConfig[], configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, extraTypes };
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function loadConfig(configPath?: string): AppConfig {
  const p = configPath ?? getUserConfigPath();
  if (!existsSync(p)) return DEFAULT_CONFIG;
  const parsed = parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>;
  return deepMerge(DEFAULT_CONFIG as any, parsed) as AppConfig;
}

export function getUserConfigPath(): string {
  return resolve(homedir(), '.codingcode', 'config.yaml');
}

export function ensureUserConfig(): void {
  const p = getUserConfigPath();
  if (existsSync(p)) return;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, stringifyYaml(DEFAULT_CONFIG), 'utf8');
}
