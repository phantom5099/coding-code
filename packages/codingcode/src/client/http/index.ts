import { createRequestHelpers } from './request.js';
import { createHttpAgentClient, type AgentRuntimeClient } from './agent-runtime.js';
import { createHttpSessionClient, type SessionClient } from './sessions.js';
import { createHttpModelClient, type ModelClient } from './models.js';
import { createHttpSettingsClient, type SettingsClient } from './settings.js';

export type { AgentRuntimeClient, SessionClient, ModelClient, SettingsClient };

export interface HttpClients {
  agent: AgentRuntimeClient;
  sessions: SessionClient;
  models: ModelClient;
  settings: SettingsClient;
}

export function createHttpClients(baseUrl: string): HttpClients {
  const request = createRequestHelpers(baseUrl);
  return {
    agent: createHttpAgentClient(baseUrl, request),
    sessions: createHttpSessionClient(request),
    models: createHttpModelClient(request),
    settings: createHttpSettingsClient(request),
  };
}
