import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ContextConfig {
  /** Model for context compaction. Empty string falls back to main session LLM.
   *  Use full id format "model@API_KEY_ENV" to avoid ambiguity (e.g. "deepseek-chat@DEEPSEEK_API_KEY").
   *  Can also use bare model id (e.g. "deepseek-chat") or display name, first match wins. */
  compactionModel: string;
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
  extraTypes: MemoryTypeConfig[];
  disabledTypes: string[];
  promptMaxBytes: number;
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
  compactionModel: '',
};

export const DEFAULT_MEMORY_TYPES: MemoryTypeConfig[] = [
  { name: 'user', description: '用户角色、技能栈、工作偏好及对 Agent 的纠正', enabled: true },
  { name: 'project', description: '架构决策、技术选型、部署信息', enabled: true },
  { name: 'reference', description: '外部资源、文档、Dashboard 链接', enabled: true },
];

export const DEFAULT_MEMORY: MemoryConfig = {
  enabled: false,
  model: '',
  extraTypes: [],
  disabledTypes: [],
  promptMaxBytes: 8192,
};

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 200,
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

function readExistingConfig(configPath: string): Record<string, unknown> {
  return existsSync(configPath)
    ? (parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>)
    : {};
}

function writeConfig(configPath: string, data: Record<string, unknown>): void {
  writeFileSync(configPath, stringifyYaml(data), 'utf8');
}

export function updateActiveModel(model: string, apiKeyEnv: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  existing.activeModel = { model, apiKeyEnv };
  writeConfig(p, existing);
}

export function updateMemoryEnabled(enabled: boolean, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, enabled };
  writeConfig(p, existing);
}

export function updateMemoryDisabledTypes(disabledTypes: string[], configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, disabledTypes };
  writeConfig(p, existing);
}

export function updateMemoryExtraTypes(extraTypes: MemoryTypeConfig[], configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, extraTypes };
  writeConfig(p, existing);
}

export function updateMemoryModel(model: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, model };
  writeConfig(p, existing);
}

export function updateMaxSteps(maxSteps: number, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  existing.maxSteps = maxSteps;
  writeConfig(p, existing);
}

export function updateMaxStopContinuations(
  maxStopContinuations: number,
  configPath?: string
): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  existing.maxStopContinuations = maxStopContinuations;
  writeConfig(p, existing);
}

export function updateContextCompactionModel(compactionModel: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const context = (existing.context as Record<string, unknown>) ?? {};
  existing.context = { ...context, compactionModel };
  writeConfig(p, existing);
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
