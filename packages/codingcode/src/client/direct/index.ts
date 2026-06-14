import { createDirectAgentClient, type AgentRuntimeClient } from './agent-runtime.js';
import { createDirectSessionClient, type SessionClient } from './sessions.js';
import { createDirectModelClient, type ModelClient } from './models.js';
import { createDirectSettingsClient, type SettingsClient } from './settings.js';
import { ManagedRuntime } from 'effect';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export interface DirectClients {
  agent: AgentRuntimeClient;
  sessions: SessionClient;
  models: ModelClient;
  settings: SettingsClient;
}

export function createDirectClients(llm: any, rt: ManagedRt): DirectClients {
  return {
    agent: createDirectAgentClient(llm, rt),
    sessions: createDirectSessionClient(rt),
    models: createDirectModelClient(rt),
    settings: createDirectSettingsClient(rt),
  };
}
