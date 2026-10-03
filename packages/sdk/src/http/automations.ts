import type { AutomationClient } from '../contracts.js';
import type { createRequestHelpers } from './request.js';

export function createHttpAutomationClient(
  request: ReturnType<typeof createRequestHelpers>
): AutomationClient {
  const { apiGet, apiPost, apiPatch, apiDelete } = request;

  return {
    listAutomations() {
      return apiGet('/api/automations');
    },

    createAutomation(input) {
      return apiPost('/api/automations', input);
    },

    updateAutomation(id, patch) {
      return apiPatch(`/api/automations/${id}`, patch);
    },

    deleteAutomation(id) {
      return apiDelete(`/api/automations/${id}`);
    },

    runAutomationOnce(id) {
      return apiPost(`/api/automations/${id}/run`);
    },
  };
}
