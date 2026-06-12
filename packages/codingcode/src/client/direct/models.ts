import { Effect } from 'effect';
import {
  getActiveEntry,
  getLLMClient,
  listModels,
  switchModel as switchActiveModel,
} from '../../llm/factory.js';

export interface ModelClient {
  listModels(): Promise<any>;
  switchModel(input: { id: string }): Promise<void>;
}

export function createDirectModelClient(): ModelClient {
  return {
    async listModels() {
      const modelsResult = Effect.runSync(listModels().pipe(Effect.either));
      if (modelsResult._tag === 'Left') throw modelsResult.left;
      const activeResult = Effect.runSync(getActiveEntry().pipe(Effect.either));
      return {
        models: modelsResult.right,
        activeId: activeResult._tag === 'Right' ? activeResult.right.id : null,
      };
    },

    async switchModel({ id }) {
      const switchResult = Effect.runSync(switchActiveModel(id).pipe(Effect.either));
      if (switchResult._tag === 'Left') throw switchResult.left;
    },
  };
}
