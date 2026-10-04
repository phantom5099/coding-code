import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getGlobalDir } from '../core/path.js';

export interface ContextConfig {
  compactionModel: string;
}

export interface MemoryConfig {
  enabled: boolean;
  model: string;
  promptMaxBytes: number;
}

export interface ActiveModelConfig {
  model: string;
  apiKeyEnv: string;
}

export interface SubagentConfig {
  maxBackground: number;
}

export interface AppConfig {
  server: {
    port: number;
  };
  maxSteps: number;
  maxStopContinuations: number;
  activeModel?: ActiveModelConfig;
  activeProfile: string;
  permissionMode: string;
  context: ContextConfig;
  memory: MemoryConfig;
  subagent: SubagentConfig;
}

const DEFAULT_CONTEXT: ContextConfig = {
  compactionModel: '',
};

export const DEFAULT_MEMORY: MemoryConfig = {
  enabled: false,
  model: '',
  promptMaxBytes: 8192,
};

export const DEFAULT_SUBAGENT: SubagentConfig = {
  maxBackground: 4,
};

export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 200,
  maxStopContinuations: 2,
  activeProfile: 'build',
  permissionMode: 'ask',
  context: DEFAULT_CONTEXT,
  memory: DEFAULT_MEMORY,
  subagent: DEFAULT_SUBAGENT,
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

export function updateActiveProfile(activeProfile: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  existing.activeProfile = activeProfile;
  writeConfig(p, existing);
}

export function updatePermissionMode(permissionMode: string, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  existing.permissionMode = permissionMode;
  writeConfig(p, existing);
}

export function updateMemoryEnabled(enabled: boolean, configPath?: string): void {
  const p = configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const memory = (existing.memory as Record<string, unknown>) ?? {};
  existing.memory = { ...memory, enabled };
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
  return join(getGlobalDir(), 'config.yaml');
}

export function ensureUserConfig(): void {
  const p = getUserConfigPath();
  if (existsSync(p)) return;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, stringifyYaml(DEFAULT_CONFIG), 'utf8');
}
