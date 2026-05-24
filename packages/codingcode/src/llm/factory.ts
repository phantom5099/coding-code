import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { AgentError } from '../core/error';
import { getInstallRoot } from '../core/workspace.js';
import { Result } from '../core/result';
import type { LLMClient } from './client';
import { OpenAIProvider } from './providers/openai';
import { DeepSeekProvider } from './providers/deepseek';
import { loadConfig } from '@codingcode/infra';

export interface ModelDescriptor {
  id: string;
  name: string;
}

export interface ProviderEntry {
  name: string;
  driver: string;
  base_url: string;
  api_key_env: string;
  default_model: string;
  models: ModelDescriptor[];
}

interface ProviderCatalog {
  providers: ProviderEntry[];
}

export interface SelectableModel {
  id: string;
  provider: string;
  driver: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
}

function modelsFile(): string {
  return resolve(getInstallRoot(), 'config/models.json');
}

let catalog: ProviderCatalog | null = null;
let currentEntry: SelectableModel | null = null;
let currentClient: LLMClient | null = null;

function loadCatalog(): Result<ProviderCatalog, AgentError> {
  if (catalog) return Result.ok(catalog);
  const path = modelsFile();
  if (!existsSync(path)) {
    return Result.err(AgentError.configMissing(path));
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as ProviderCatalog;
    if (!parsed.providers || parsed.providers.length === 0) {
      return Result.err(new AgentError('CONFIG_INVALID', 'models.json has no providers defined'));
    }
    catalog = parsed;
    return Result.ok(catalog);
  } catch (e) {
    return Result.err(new AgentError('CONFIG_INVALID', `Failed to parse models.json: ${e}`));
  }
}

function flattenModels(cat: ProviderCatalog): SelectableModel[] {
  const result: SelectableModel[] = [];
  for (const p of cat.providers) {
    for (const m of p.models) {
      result.push({
        id: `${m.id}@${p.api_key_env}`,
        provider: p.name,
        driver: p.driver,
        name: m.name,
        model: m.id,
        base_url: p.base_url,
        api_key_env: p.api_key_env,
      });
    }
  }
  return result;
}

export function listModels(): Result<SelectableModel[], AgentError> {
  const catResult = loadCatalog();
  if (!catResult.ok) return catResult;
  return Result.ok(flattenModels(catResult.value));
}

/**
 * Find a model by identifier with priority:
 *  1. Exact match on full id (e.g. "deepseek-chat@DEEPSEEK_API_KEY")
 *  2. First match on bare model id (e.g. "deepseek-chat")
 *  3. First match on display name (e.g. "DeepSeek Chat")
 * Returns null if not found, ensuring no ambiguity when multiple providers have same model name.
 */
export function findModel(target: string): SelectableModel | null {
  const listResult = listModels();
  if (!listResult.ok) return null;

  const models = listResult.value;
  // Priority 1: exact match on full id
  const exactMatch = models.find((m) => m.id === target);
  if (exactMatch) return exactMatch;

  // Priority 2 & 3: first match on model id or name
  return models.find((m) => m.model === target || m.name === target) || null;
}

export function getActiveEntry(): Result<SelectableModel, AgentError> {
  if (currentEntry) return Result.ok(currentEntry);

  const cfg = loadConfig().activeModel;
  if (!cfg) {
    return Result.err(new AgentError('CONFIG_INVALID', 'No active model configured. Set activeModel in config.yaml with model and apiKeyEnv fields'));
  }

  const catResult = loadCatalog();
  if (!catResult.ok) return catResult;

  const found = flattenModels(catResult.value).find((m) => m.model === cfg.model && m.api_key_env === cfg.apiKeyEnv);
  if (!found) {
    return Result.err(new AgentError('CONFIG_INVALID', `Model "${cfg.model}" with apiKeyEnv "${cfg.apiKeyEnv}" not found in models.json`));
  }

  currentEntry = found;
  return Result.ok(currentEntry);
}

export function switchModel(id: string): Result<SelectableModel, AgentError> {
  const catResult = loadCatalog();
  if (!catResult.ok) return catResult;
  const all = flattenModels(catResult.value);
  const found = all.find((m) => m.id === id);
  if (!found) return Result.err(new AgentError('CONFIG_INVALID', `Model "${id}" not found. Use /model to list.`));
  currentEntry = found;
  currentClient = null;
  return Result.ok(found);
}

export async function createClient(entry: SelectableModel): Promise<Result<LLMClient, AgentError>> {
  const apiKey = process.env[entry.api_key_env] || process.env.OPENAI_API_KEY || '';

  switch (entry.driver) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const provider = createOpenAI({
        name: entry.provider,
        baseURL: entry.base_url,
        apiKey,
      });
      return Result.ok(new OpenAIProvider(provider.chat(entry.model), entry));
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      const deepseek = createDeepSeek({
        baseURL: entry.base_url,
        apiKey,
      });
      return Result.ok(new DeepSeekProvider(deepseek(entry.model), entry));
    }
    default:
      return Result.err(new AgentError('CONFIG_INVALID', `Unknown driver "${entry.driver}" for provider "${entry.provider}"`));
  }
}

export async function getLLMClient(): Promise<Result<LLMClient, AgentError>> {
  if (currentClient) return Result.ok(currentClient);
  const entryResult = getActiveEntry();
  if (!entryResult.ok) return entryResult;
  const clientResult = await createClient(entryResult.value);
  if (!clientResult.ok) return clientResult;
  currentClient = clientResult.value;
  return Result.ok(currentClient);
}
