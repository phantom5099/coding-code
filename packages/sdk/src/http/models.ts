import type { ModelClient } from '../contracts.js';
import type { createRequestHelpers } from './request.js';

export function createHttpModelClient(
  request: ReturnType<typeof createRequestHelpers>
): ModelClient {
  const { apiGet } = request;

  return {
    async listModels() {
      return apiGet('/api/models');
    },
  };
}

export type { ModelClient };
