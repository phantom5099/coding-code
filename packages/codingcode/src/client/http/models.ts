import type { ModelClient } from '../contracts.js';
import type { createRequestHelpers } from './request.js';

export function createHttpModelClient(
  request: ReturnType<typeof createRequestHelpers>
): ModelClient {
  const { apiGet, apiPost } = request;

  return {
    async listModels() {
      return apiGet('/api/models');
    },

    async switchModel({ id }) {
      await apiPost('/api/models/switch', { modelId: id });
    },
  };
}

export type { ModelClient };
