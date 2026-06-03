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
      const modelsResult = listModels();
      if (!modelsResult.ok) throw modelsResult.error;
      const activeResult = getActiveEntry();
      return {
        models: modelsResult.value,
        activeId: activeResult.ok ? activeResult.value.id : null,
      };
    },

    async switchModel({ id }) {
      const switchResult = switchActiveModel(id);
      if (!switchResult.ok) throw switchResult.error;
    },
  };
}
