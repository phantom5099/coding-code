import { createRequestHelpers } from './request.js';
import { createHttpAgentClient } from './agent-runtime.js';
import { createHttpSessionClient } from './sessions.js';
import { createHttpModelClient } from './models.js';
import { createHttpSettingsClient } from './settings.js';
import type {
  AgentRuntimeClient,
  SessionClient,
  ModelClient,
  SettingsClient,
} from '../contracts.js';

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
