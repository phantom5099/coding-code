import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { LLMClient } from './client.js';

export interface ModelDescriptor { id: string; name: string; context_window?: number }
export interface ProviderEntry { name: string; driver: string; base_url: string; api_key_env: string; default_model: string; models: ModelDescriptor[] }
export interface SelectableModel { id: string; provider: string; driver: string; name: string; model: string; base_url: string; api_key_env: string; context_window: number }

export interface LLMFactoryShape {
  listModels(): Effect.Effect<SelectableModel[], AgentError>;
  findModel(target: string): Effect.Effect<SelectableModel | null, AgentError>;
  getActiveEntry(): Effect.Effect<SelectableModel, AgentError>;
  switchModel(id: string): Effect.Effect<SelectableModel, AgentError>;
  createClient(entry: SelectableModel): Effect.Effect<LLMClient, AgentError>;
  getLLMClient(): Effect.Effect<LLMClient, AgentError>;
}

export class LLMFactoryService extends Context.Tag('LLMFactory')<LLMFactoryService, LLMFactoryShape>() {}
