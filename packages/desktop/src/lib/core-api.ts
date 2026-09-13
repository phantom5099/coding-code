import { API_BASE, api } from './api';
import { createHttpClients, type AgentRuntimeClient } from '@codingcode/core/client';
import type { PermissionMode } from '@codingcode/core/approval/types';
import type { ProfileName, TokenUsage } from '@codingcode/core/core/types';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  RollbackPreviewDiff,
} from '@codingcode/core/checkpoint/types';
import type { UITurn } from '@codingcode/core/session/port';
import type { McpServerConfig } from '@codingcode/core/mcp/types';
import type { UserHookConfig } from '@codingcode/core/hooks/types';

const clients = createHttpClients(API_BASE);

export const agentClient: AgentRuntimeClient = clients.agent;

export type { AgentRuntimeClient };

// ---- Models ----

export function listModels(): Promise<{
  models: Array<{ id: string; name: string; provider: string; context_window: number }>;
  activeId: string | null;
}> {
  return clients.models.listModels();
}

export function switchModel(id: string): Promise<void> {
  return clients.models.switchModel({ id });
}

// ---- Sessions ----

export function listSessions(cwd?: string): Promise<any[]> {
  return clients.sessions.listSessions({ cwd: cwd ?? '' });
}

export function createSession(
  cwd: string,
  params: { activeProfile: ProfileName; permissionMode: PermissionMode; model: string }
): Promise<{ sessionId: string }> {
  return clients.sessions.createSession({ cwd, ...params });
}

export function deleteSession(sessionId: string, cwd: string): Promise<void> {
  return clients.sessions.deleteSession({ sessionId, cwd });
}

export function getSessionHistory(sessionId: string, cwd: string): Promise<UITurn[]> {
  return clients.sessions.getSessionHistory({ sessionId, cwd });
}

export function resumeSession(sessionId: string, cwd: string): Promise<UITurn[]> {
  return clients.sessions.resumeSession({ sessionId, cwd });
}

export function setSessionPermissionMode(
  sessionId: string,
  cwd: string,
  mode: PermissionMode
): Promise<void> {
  return clients.sessions.setSessionPermissionMode({ sessionId, cwd, mode });
}

export function sendApprovalResponse(
  sessionId: string,
  callId: string,
  response: string
): Promise<void> {
  return clients.agent.sendApprovalResponse({ sessionId, approvalId: callId, response });
}

// ---- Plan file ----

export function getSessionPlan(
  sessionId: string,
  cwd: string
): Promise<{ content: string; path: string; directory: string; exists: boolean }> {
  return clients.sessions.getSessionPlan({ sessionId, cwd });
}

// ---- Agent profile switching ----

export type SessionProfileInfo = {
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  cwd: string;
  available: Array<{ name: string; description: string }>;
};

export function getSessionProfile(sessionId: string, cwd: string): Promise<SessionProfileInfo> {
  return clients.sessions.getSessionProfile({ sessionId, cwd });
}

export function setSessionProfile(
  sessionId: string,
  cwd: string,
  activeProfile: ProfileName
): Promise<{ activeProfile: ProfileName; permissionMode: PermissionMode }> {
  return clients.sessions.setSessionProfile({ sessionId, cwd, activeProfile });
}

// ---- Settings: Memory ----

export function getMemoryConfig(): Promise<{
  enabled: boolean;
  model: string;
}> {
  return clients.settings.getMemoryConfig();
}

export function setMemoryEnabled(enabled: boolean): Promise<void> {
  return clients.settings.setMemoryEnabled(enabled);
}

export function setMemoryModel(model: string): Promise<{ model: string }> {
  return clients.settings.setMemoryModel(model);
}

// ---- Settings: Agent config ----

export async function getAgentConfig(): Promise<{
  maxSteps: number;
  maxStopContinuations: number;
}> {
  return clients.settings.getAgentConfig();
}

export async function setAgentConfig(partial: {
  maxSteps?: number;
  maxStopContinuations?: number;
}): Promise<{ maxSteps: number; maxStopContinuations: number }> {
  return api('/api/settings/agent/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
}

// ---- Settings: Context config ----

export async function setCompactionModel(
  compactionModel: string
): Promise<{ compactionModel: string }> {
  return clients.settings.setCompactionModel(compactionModel);
}

// ---- Settings: MCP ----

export function listMcpServers(cwd?: string): Promise<any[]> {
  return clients.settings.getMcpStatus({ cwd: cwd ?? '' });
}

export function setMcpDisabled(name: string, disabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.setMcpDisabled({ name, disabled, cwd: cwd ?? '' });
}

export function resetMcpDisabled(name: string, cwd: string): Promise<void> {
  return clients.settings.resetMcpDisabled({ name, cwd });
}

export function createMcpServer(cwd: string | undefined, server: McpServerConfig): Promise<void> {
  return clients.settings.createMcpServer({ cwd: cwd ?? '', server });
}

export function updateMcpServer(
  cwd: string | undefined,
  name: string,
  server: McpServerConfig
): Promise<void> {
  return clients.settings.updateMcpServer({ cwd: cwd ?? '', name, server });
}

export function deleteMcpServer(cwd: string | undefined, name: string): Promise<void> {
  return clients.settings.deleteMcpServer({ cwd: cwd ?? '', name });
}

// ---- Settings: Skills ----

export function listSkills(_cwd?: string): Promise<
  Array<{
    name: string;
    description: string;
    skillPath: string;
    source?: 'global' | 'project';
    hasProjectOverride?: boolean;
  }>
> {
  return clients.settings.listSkills();
}

// ---- Settings: Hooks ----

export function listHooks(cwd?: string): Promise<UserHookConfig[]> {
  return clients.settings.listHooks({ cwd: cwd ?? '' });
}

export function createHook(cwd: string | undefined, hook: UserHookConfig): Promise<void> {
  return clients.settings.createHook({ cwd: cwd ?? '', hook });
}

export function updateHook(
  cwd: string | undefined,
  name: string,
  hook: UserHookConfig
): Promise<void> {
  return clients.settings.updateHook({ cwd: cwd ?? '', name, hook });
}

export function deleteHook(cwd: string | undefined, name: string): Promise<void> {
  return clients.settings.deleteHook({ cwd: cwd ?? '', name });
}

export function setHookDisabled(
  cwd: string | undefined,
  name: string,
  disabled: boolean
): Promise<void> {
  return clients.settings.setHookDisabled({ cwd: cwd ?? '', name, disabled });
}

export function resetHookDisabled(name: string, cwd: string): Promise<void> {
  return clients.settings.resetHookDisabled({ name, cwd });
}

// ---- Rollback / Checkpoint ----

export type { CheckpointDiff, CodeRollbackResult, RollbackPreviewDiff };

export function getCheckpointDiff(
  sessionId: string,
  cwd: string,
  turnId?: number
): Promise<CheckpointDiff> {
  return clients.sessions.getCheckpointDiff({ sessionId, cwd, turnId });
}

export function revertCheckpointFiles(
  sessionId: string,
  cwd: string,
  files: string[]
): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return clients.sessions.revertCheckpointFiles({ sessionId, cwd, files }).then((result) => ({
    ok: true,
    result,
  }));
}

export function previewRollbackDiff(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<RollbackPreviewDiff> {
  return clients.sessions.previewRollbackDiff({ sessionId, cwd, throughTurnId });
}

export function rollbackCodeToTurn(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return clients.sessions
    .rollbackCodeToTurn({ sessionId, cwd, throughTurnId })
    .then((result) => ({ ok: true, result }));
}

export function rollbackContext(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{
  ok: boolean;
  turns: UITurn[];
  promptEstimate?: number;
  usage?: TokenUsage;
}> {
  return clients.sessions.rollbackContext({ sessionId, cwd, throughTurnId }).then((r) => ({
    ok: true,
    turns: r.turns,
  }));
}

export function rollbackBothToTurn(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{
  ok: boolean;
  turns: UITurn[];
  codeResult: CodeRollbackResult;
  promptEstimate?: number;
  usage?: TokenUsage;
}> {
  return clients.sessions.rollbackBothToTurn({ sessionId, cwd, throughTurnId }).then((r) => ({
    ok: true,
    ...r,
  }));
}

export function forkSession(
  sessionId: string,
  cwd: string,
  atTurnId?: number
): Promise<{ sessionId: string; turns: UITurn[] }> {
  return clients.sessions.forkSession({ sessionId, cwd, atTurnId });
}

// ---- Automations ----

export interface Automation {
  id: string;
  name: string;
  description: string;
  cron: string;
  timezone: string;
  sandbox: 'readonly' | 'workspace-write';
  enabled: boolean;
  projectCwd: string;
  runOnce: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastSessionId: string | null;
}

export interface CreateAutomationInput {
  name: string;
  description: string;
  cron: string;
  timezone?: string;
  sandbox?: 'readonly' | 'workspace-write';
  projectCwd: string;
  runOnce?: boolean;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  cron?: string;
  timezone?: string;
  sandbox?: 'readonly' | 'workspace-write';
  enabled?: boolean;
  runOnce?: boolean;
}

export async function listAutomations(): Promise<Automation[]> {
  const res = await fetch(`${API_BASE}/api/automations`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createAutomation(data: CreateAutomationInput): Promise<Automation> {
  const res = await fetch(`${API_BASE}/api/automations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateAutomation(
  id: string,
  data: UpdateAutomationInput
): Promise<Automation> {
  const res = await fetch(`${API_BASE}/api/automations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteAutomation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/automations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function runAutomationOnce(id: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${API_BASE}/api/automations/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
