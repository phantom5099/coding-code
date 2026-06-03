import { createDirectAgentClient, type AgentRuntimeClient } from './agent-runtime.js';
import { createDirectSessionClient, type SessionClient } from './sessions.js';
import { createDirectModelClient, type ModelClient } from './models.js';
import { createDirectSettingsClient, type SettingsClient } from './settings.js';

export type { AgentRuntimeClient, SessionClient, ModelClient, SettingsClient };

export interface DirectClients {
  agent: AgentRuntimeClient;
  sessions: SessionClient;
  models: ModelClient;
  settings: SettingsClient;
}

export function createDirectClients(
  llm: any,
  runWithLayer: <T>(eff: any) => Promise<T>
): DirectClients {
  return {
    agent: createDirectAgentClient(llm, runWithLayer),
    sessions: createDirectSessionClient(runWithLayer),
    models: createDirectModelClient(),
    settings: createDirectSettingsClient(runWithLayer),
  };
}
