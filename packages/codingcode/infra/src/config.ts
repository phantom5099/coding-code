import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  getGlobalDir,
  isPermissionMode,
  type PermissionMode,
} from '@codingcode/util';

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
  maxSteps: number;
  maxStopContinuations: number;
  activeModel?: ActiveModelConfig;
  permissionMode: PermissionMode;
  context: ContextConfig;
  memory: MemoryConfig;
  subagent: SubagentConfig;
}

export interface AppConfigPatch {
  readonly maxSteps?: number;
  readonly maxStopContinuations?: number;
  readonly activeModel?: ActiveModelConfig;
  readonly permissionMode?: PermissionMode;
  readonly context?: Partial<ContextConfig>;
  readonly memory?: Partial<MemoryConfig>;
  readonly subagent?: Partial<SubagentConfig>;
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
  maxSteps: 200,
  maxStopContinuations: 2,
  permissionMode: ASK_BEFORE_EXEC_PERMISSION_MODE,
  context: DEFAULT_CONTEXT,
  memory: DEFAULT_MEMORY,
  subagent: DEFAULT_SUBAGENT,
};

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function deepMergeRecord(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val === undefined) continue;
    const prev = result[key];
    result[key] = isRecord(val) && isRecord(prev) ? deepMergeRecord(prev, val) : val;
  }
  return result;
}

function readExistingConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  const parsed = parseYaml(readFileSync(configPath, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function writeConfig(configPath: string, data: Record<string, unknown>): void {
  writeFileSync(configPath, stringifyYaml(data), 'utf8');
}

export function updateAppConfig(
  patch: AppConfigPatch,
  opts?: { readonly configPath?: string }
): void {
  const p = opts?.configPath ?? getUserConfigPath();
  const existing = readExistingConfig(p);
  const next = deepMergeRecord(existing, patch as unknown as Record<string, unknown>);
  writeConfig(p, next);
}

export function updateActiveModel(active: ActiveModelConfig, configPath?: string): void {
  updateAppConfig({ activeModel: active }, { configPath });
}

export function updatePermissionMode(permissionMode: PermissionMode, configPath?: string): void {
  updateAppConfig({ permissionMode }, { configPath });
}

export function updateMemoryEnabled(enabled: boolean, configPath?: string): void {
  updateAppConfig({ memory: { enabled } }, { configPath });
}

export function updateMemoryModel(model: string, configPath?: string): void {
  updateAppConfig({ memory: { model } }, { configPath });
}

export function updateContextCompactionModel(compactionModel: string, configPath?: string): void {
  updateAppConfig({ context: { compactionModel } }, { configPath });
}

export function loadConfig(configPath?: string): AppConfig {
  const p = configPath ?? getUserConfigPath();
  if (!existsSync(p)) return DEFAULT_CONFIG;
  const raw = readExistingConfig(p);
  const merged = deepMergeRecord(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    raw
  ) as unknown as AppConfig;
  if (!isPermissionMode(merged.permissionMode)) {
    merged.permissionMode = ASK_BEFORE_EXEC_PERMISSION_MODE;
  }
  return merged;
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
