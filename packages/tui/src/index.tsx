import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import type { StreamChunk } from '@codingcode/core/client/types';
import { createDirectAgentClient } from '@codingcode/core/direct/agent-runtime';
import { createDirectSessionClient } from '@codingcode/core/direct/sessions';
import { createDirectSettingsClient } from '@codingcode/core/direct/settings';
import { createDirectModelClient } from '@codingcode/core/direct/models';
import type { LLMClient } from '@codingcode/core/llm/client';
import type { AppRuntime } from '@codingcode/core/layer';

export type { StreamChunk };

export interface TuiClient {
  sendMessage(input: string): AsyncGenerator<StreamChunk>;
  sendApprovalResponse(id: string, response: string): Promise<void>;
  getSessionId(): string;
  compact(): Promise<void>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  getMemoryEnabled(): Promise<boolean>;
  setSubagentEnabled(body: { enabled: boolean; cwd: string }): Promise<void>;
  getSubagentEnabled(query: { cwd: string }): Promise<{ enabled: boolean; source: string }>;
  listModels(): Promise<{ models: any[]; activeId: string | null }>;
  switchModel(id: string): Promise<void>;
  listSessions(): Promise<any[]>;
  getMcpStatus(query: { cwd: string }): Promise<any[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  listSkills(): Promise<any[]>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  getPermissionMode(input: {
    sessionId: string;
    cwd: string;
  }): Promise<import('@codingcode/core/approval/types').PermissionMode>;
  setPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: import('@codingcode/core/approval/types').PermissionMode;
  }): Promise<void>;
  resumeSession(sid: string): Promise<any>;
}

export function createTuiClientFromFacades(llm: LLMClient, rt: AppRuntime): TuiClient {
  const agent = createDirectAgentClient(llm, rt);
  const sessions = createDirectSessionClient(rt);
  const settings = createDirectSettingsClient(rt);
  const models = createDirectModelClient(rt);

  let currentSessionId = '';

  return {
    async *sendMessage(input: string): AsyncGenerator<StreamChunk> {
      const stream = agent.sendMessage(input, { sessionId: currentSessionId, cwd: '' });
      for await (const chunk of stream) {
        if (chunk.type === 'session_id') {
          currentSessionId = chunk.sessionId as string;
        }
        yield chunk;
      }
    },
    sendApprovalResponse: (id, response) =>
      agent.sendApprovalResponse({ sessionId: currentSessionId, approvalId: id, response }),
    getSessionId: () => currentSessionId,
    compact: () => agent.compact({ sessionId: currentSessionId, cwd: '' }),
    setMemoryEnabled: (enabled) => settings.setMemoryEnabled(enabled),
    getMemoryEnabled: () => settings.getMemoryEnabled(),
    setSubagentEnabled: (body) => settings.setSubagentEnabled(body),
    getSubagentEnabled: (query) => settings.getSubagentEnabled(query),
    listModels: () => models.listModels(),
    switchModel: (id) => models.switchModel({ id }),
    listSessions: () => sessions.listSessions({ cwd: '' }),
    getMcpStatus: (query) => settings.getMcpStatus(query),
    setMcpDisabled: (body) => settings.setMcpDisabled(body),
    listSkills: () => settings.listSkills(),
    toggleSkill: (body) => settings.toggleSkill(body),
    getPermissionMode: (input) => settings.getGlobalPermissionMode(input),
    setPermissionMode: (input) => settings.setGlobalPermissionMode(input),
    resumeSession: (sid) => sessions.resumeSession({ sessionId: sid, cwd: '' }),
  };
}

interface TuiOptions {
  client: TuiClient;
}

export async function runTui(options: TuiOptions) {
  render(<App client={options.client} />);
}
