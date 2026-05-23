import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

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
  models: Record<string, {
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
  }>;
  activeModel?: ActiveModelConfig;
  context: ContextConfig;
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
  compactionModel: 'haiku',
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

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 50,
  maxStopContinuations: 2,
  models: {},
  context: DEFAULT_CONTEXT,
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

export function loadConfig(configPath?: string, installRoot?: string): AppConfig {
  const root = installRoot ?? process.cwd();
  const paths = configPath
    ? [configPath]
    : [resolve(root, 'config/config.yaml'), resolve(root, 'config/config.yml')];

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      return deepMerge(DEFAULT_CONFIG as any, parsed) as AppConfig;
    }
  }
  return DEFAULT_CONFIG;
}
