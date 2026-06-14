import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
import { WorkspaceService } from '../core/workspace.js';
import type { LLMClient } from './client.js';
import { OpenAIProvider } from './providers/openai.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { updateActiveModel } from '@codingcode/infra/config';

export interface ModelDescriptor {
  id: string;
  name: string;
  context_window?: number;
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
  context_window: number;
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
        context_window: m.context_window ?? 128000,
      });
    }
  }
  return result;
}

export class LLMFactoryService extends Effect.Service<LLMFactoryService>()('LLMFactory', {
  effect: Effect.gen(function* () {
    const workspace = yield* WorkspaceService;
    let catalog: ProviderCatalog | null = null;
    let currentEntry: SelectableModel | null = null;
    let currentClient: LLMClient | null = null;

    function modelsFile(): string {
      return resolve(workspace.getProcessRoot(), 'config/models.json');
    }

    const loadCatalog = (): Effect.Effect<ProviderCatalog, AgentError> =>
      Effect.gen(function* () {
        if (catalog) return catalog;
        const path = modelsFile();
        if (!existsSync(path)) {
          return yield* Effect.fail(AgentError.configMissing(path));
        }
        try {
          const raw = readFileSync(path, 'utf-8');
          const parsed = JSON.parse(raw) as ProviderCatalog;
          if (!parsed.providers || parsed.providers.length === 0) {
            return yield* Effect.fail(
              new AgentError('CONFIG_INVALID', 'models.json has no providers defined')
            );
          }
          catalog = parsed;
          return catalog;
        } catch (e) {
          return yield* Effect.fail(
            new AgentError('CONFIG_INVALID', `Failed to parse models.json: ${e}`)
          );
        }
      });

    return {
      listModels: (): Effect.Effect<SelectableModel[], AgentError> =>
        Effect.gen(function* () {
          const cat = yield* loadCatalog();
          return flattenModels(cat);
        }),

      findModel: (target: string): Effect.Effect<SelectableModel | null, AgentError> =>
        Effect.gen(function* () {
          const cat = yield* loadCatalog().pipe(Effect.either);
          if (cat._tag === 'Left') return null;
          const models = flattenModels(cat.right);
          const exactMatch = models.find((m) => m.id === target);
          if (exactMatch) return exactMatch;
          return models.find((m) => m.model === target || m.name === target) || null;
        }),

      getActiveEntry: (): Effect.Effect<SelectableModel, AgentError> =>
        Effect.gen(function* () {
          if (currentEntry) return currentEntry;
          const cfg = workspace.getConfig().activeModel;
          if (!cfg) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_INVALID',
                'No active model configured. Set activeModel in config.yaml with model and apiKeyEnv fields'
              )
            );
          }
          const cat = yield* loadCatalog();
          const found = flattenModels(cat).find(
            (m) => m.model === cfg.model && m.api_key_env === cfg.apiKeyEnv
          );
          if (!found) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_INVALID',
                `Model "${cfg.model}" with apiKeyEnv "${cfg.apiKeyEnv}" not found in models.json`
              )
            );
          }
          currentEntry = found;
          return currentEntry;
        }),

      switchModel: (id: string): Effect.Effect<SelectableModel, AgentError> =>
        Effect.gen(function* () {
          const cat = yield* loadCatalog();
          const all = flattenModels(cat);
          const found = all.find((m) => m.id === id);
          if (!found)
            return yield* Effect.fail(
              new AgentError('CONFIG_INVALID', `Model "${id}" not found. Use /model to list.`)
            );
          currentEntry = found;
          currentClient = null;
          updateActiveModel(found.model, found.api_key_env);
          return found;
        }),

      createClient: (entry: SelectableModel): Effect.Effect<LLMClient, AgentError> =>
        Effect.gen(function* () {
          const apiKey = process.env[entry.api_key_env] || process.env.OPENAI_API_KEY || '';
          if (!apiKey) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_MISSING',
                `API key not found. Set environment variable "${entry.api_key_env}" or "OPENAI_API_KEY".`,
                undefined,
                { apiKeyEnv: entry.api_key_env }
              )
            );
          }

          switch (entry.driver) {
            case 'openai': {
              const { createOpenAI } = yield* Effect.tryPromise({
                try: () => import('@ai-sdk/openai'),
                catch: (e) =>
                  new AgentError('CONFIG_INVALID', `Failed to import openai driver: ${e}`),
              });
              const provider = createOpenAI({
                name: entry.provider,
                baseURL: entry.base_url,
                apiKey,
              });
              return new OpenAIProvider(provider.chat(entry.model), entry);
            }
            case 'deepseek': {
              const { createDeepSeek } = yield* Effect.tryPromise({
                try: () => import('@ai-sdk/deepseek'),
                catch: (e) =>
                  new AgentError('CONFIG_INVALID', `Failed to import deepseek driver: ${e}`),
              });
              const deepseek = createDeepSeek({
                baseURL: entry.base_url,
                apiKey,
              });
              return new DeepSeekProvider(deepseek(entry.model), entry);
            }
            default:
              return yield* Effect.fail(
                new AgentError(
                  'CONFIG_INVALID',
                  `Unknown driver "${entry.driver}" for provider "${entry.provider}"`
                )
              );
          }
        }),

      getLLMClient: (): Effect.Effect<LLMClient, AgentError> =>
        Effect.gen(function* () {
          if (currentClient) return currentClient;
          const cfg = workspace.getConfig().activeModel;
          if (!cfg) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_INVALID',
                'No active model configured. Set activeModel in config.yaml with model and apiKeyEnv fields'
              )
            );
          }
          const cat = yield* loadCatalog();
          const found = flattenModels(cat).find(
            (m) => m.model === cfg.model && m.api_key_env === cfg.apiKeyEnv
          );
          if (!found) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_INVALID',
                `Model "${cfg.model}" with apiKeyEnv "${cfg.apiKeyEnv}" not found in models.json`
              )
            );
          }
          currentEntry = found;
          const apiKey = process.env[found.api_key_env] || process.env.OPENAI_API_KEY || '';
          if (!apiKey) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_MISSING',
                `API key not found. Set environment variable "${found.api_key_env}" or "OPENAI_API_KEY".`,
                undefined,
                { apiKeyEnv: found.api_key_env }
              )
            );
          }
          let client: LLMClient;
          switch (found.driver) {
            case 'openai': {
              const { createOpenAI } = yield* Effect.tryPromise({
                try: () => import('@ai-sdk/openai'),
                catch: (e) =>
                  new AgentError('CONFIG_INVALID', `Failed to import openai driver: ${e}`),
              });
              const provider = createOpenAI({
                name: found.provider,
                baseURL: found.base_url,
                apiKey,
              });
              client = new OpenAIProvider(provider.chat(found.model), found);
              break;
            }
            case 'deepseek': {
              const { createDeepSeek } = yield* Effect.tryPromise({
                try: () => import('@ai-sdk/deepseek'),
                catch: (e) =>
                  new AgentError('CONFIG_INVALID', `Failed to import deepseek driver: ${e}`),
              });
              const deepseek = createDeepSeek({ baseURL: found.base_url, apiKey });
              client = new DeepSeekProvider(deepseek(found.model), found);
              break;
            }
            default:
              return yield* Effect.fail(
                new AgentError(
                  'CONFIG_INVALID',
                  `Unknown driver "${found.driver}" for provider "${found.provider}"`
                )
              );
          }
          currentClient = client;
          return currentClient;
        }),
    };
  }),
}) {}
