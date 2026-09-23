import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { LLMClient, SelectableModel } from '../contracts/provider.js';

export interface LLMFactoryShape {
  listModels(): Effect.Effect<SelectableModel[], AgentError>;
  findModel(target: string): Effect.Effect<SelectableModel | null, AgentError>;
  getActiveEntry(): Effect.Effect<SelectableModel, AgentError>;
  switchModel(id: string): Effect.Effect<SelectableModel, AgentError>;
  createClient(entry: SelectableModel): Effect.Effect<LLMClient, AgentError>;
  getLLMClient(): Effect.Effect<LLMClient, AgentError>;
}

export class LLMFactoryService extends Context.Tag('LLMFactory')<LLMFactoryService, LLMFactoryShape>() {}
