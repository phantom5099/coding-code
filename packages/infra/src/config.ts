import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

export interface ContextThresholdsConfig {
  budgetReduction: number;
  prune: number;
  slidingWindow: number;
  collapse: number;
  compaction: number;
}

export interface ContextConfig {
  defaultMaxTokens: number;
  reservedTokens: number;
  thresholds: ContextThresholdsConfig;
  budgetReductionMaxTokensPerTool: number;
  budgetReductionKeepLines: number;
  pruneProtectedTokens: number;
  pruneMinRelease: number;
  slidingWindowCandidates: number[];
  collapseMinTokens: number;
  collapseSummaryMaxTokens: number;
  toolsExemptFromPrune: string[];
  toolsExemptFromTruncation: string[];
  prefixTurnsProtected: number;
  minTurnsBetweenCompactions: number;
  L5KeepRecentTurns: number;
  compactionFuseMaxFailures: number;
  compactionModel: string;
  archiveTtlDays: number;
  checkpointKeep: number;
}

export interface AppConfig {
  server: {
    port: number;
  };
  maxSteps: number;
  models: Record<string, {
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
  }>;
  activeModel?: string;
  context: ContextConfig;
}

const DEFAULT_CONTEXT: ContextConfig = {
  defaultMaxTokens: 200000,
  reservedTokens: 20000,
  thresholds: { budgetReduction: 0.6, prune: 0.7, slidingWindow: 0.75, collapse: 0.8, compaction: 0.9 },
  budgetReductionMaxTokensPerTool: 2000,
  budgetReductionKeepLines: 20,
  pruneProtectedTokens: 40000,
  pruneMinRelease: 20000,
  slidingWindowCandidates: [10, 6, 4, 2],
  collapseMinTokens: 500,
  collapseSummaryMaxTokens: 1500,
  toolsExemptFromPrune: ['Read'],
  toolsExemptFromTruncation: ['Read'],
  prefixTurnsProtected: 1,
  minTurnsBetweenCompactions: 5,
  L5KeepRecentTurns: 10,
  compactionFuseMaxFailures: 3,
  compactionModel: 'haiku',
  archiveTtlDays: 30,
  checkpointKeep: 50,
};

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 50,
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
