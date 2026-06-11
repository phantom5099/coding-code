import { API_BASE } from './api';
import { createHttpClients, type AgentRuntimeClient } from '@codingcode/core/client/http-clients';

const clients = createHttpClients(API_BASE);

export const agentClient: AgentRuntimeClient = clients.agent;

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
  initialPermissionMode?: string
): Promise<{ sessionId: string }> {
  return clients.sessions.createSession({ cwd, initialPermissionMode });
}

export function deleteSession(sessionId: string): Promise<void> {
  return clients.sessions.deleteSession({ sessionId });
}

export function getSessionHistory(
  sessionId: string
): Promise<Array<{ id: string; items: any[]; status: string }>> {
  return clients.sessions.getSessionHistory({ sessionId });
}

export function resumeSession(sessionId: string, cwd: string): Promise<any> {
  return clients.sessions.resumeSession({ sessionId, cwd });
}

export function setSessionPermissionMode(sessionId: string, mode: string): Promise<void> {
  return clients.sessions.setSessionPermissionMode({ sessionId, mode: mode as any });
}

export function sendApprovalResponse(
  sessionId: string,
  callId: string,
  response: string
): Promise<void> {
  return clients.agent.sendApprovalResponse({ sessionId, approvalId: callId, response });
}

// ---- Settings: Memory ----

export function getMemoryConfig(): Promise<{
  enabled: boolean;
  types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
}> {
  return clients.settings.getMemoryConfig();
}

export function setMemoryEnabled(enabled: boolean): Promise<void> {
  return clients.settings.setMemoryEnabled(enabled);
}

export function setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void> {
  return clients.settings.setMemoryTypeDisabled(name, disabled);
}

export function createMemoryExtraType(type: { name: string; description: string }): Promise<void> {
  return clients.settings.addMemoryExtraType(type);
}

export function updateMemoryExtraType(
  name: string,
  type: { name: string; description: string }
): Promise<void> {
  return clients.settings.updateMemoryExtraType(name, type);
}

export function deleteMemoryExtraType(name: string): Promise<void> {
  return clients.settings.deleteMemoryExtraType(name);
}

// ---- Settings: MCP ----

export function listMcpServers(_cwd?: string): Promise<any[]> {
  return clients.settings.getMcpStatus();
}

export function setMcpDisabled(name: string, disabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.setMcpDisabled({ name, disabled, cwd: cwd ?? '' });
}

export function resetMcpDisabled(name: string, cwd: string): Promise<void> {
  return clients.settings.resetMcpDisabled({ name, cwd });
}

export function createMcpServer(
  cwd: string | undefined,
  server: Record<string, unknown>
): Promise<void> {
  return clients.settings.createMcpServer({ cwd: cwd ?? '', server: server as any });
}

export function updateMcpServer(
  cwd: string | undefined,
  name: string,
  server: Record<string, unknown>
): Promise<void> {
  return clients.settings.updateMcpServer({ cwd: cwd ?? '', name, server: server as any });
}

export function deleteMcpServer(cwd: string | undefined, name: string): Promise<void> {
  return clients.settings.deleteMcpServer({ cwd: cwd ?? '', name });
}

// ---- Settings: Agents ----

export function listAgents(cwd?: string): Promise<any[]> {
  return clients.settings.listAgents({ cwd: cwd ?? '' });
}

export function setAgentDisabled(name: string, disabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.setAgentDisabled({ name, disabled, cwd: cwd ?? '' });
}

export function resetAgentDisabled(name: string, cwd: string): Promise<void> {
  return clients.settings.resetAgentDisabled({ name, cwd });
}

export function createAgent(
  cwd: string | undefined,
  profile: Record<string, unknown>
): Promise<void> {
  return clients.settings.createAgent({ cwd: cwd ?? '', profile: profile as any });
}

export function updateAgent(
  cwd: string | undefined,
  name: string,
  profile: Record<string, unknown>
): Promise<void> {
  return clients.settings.updateAgent({ cwd: cwd ?? '', name, profile: profile as any });
}

export function deleteAgent(cwd: string | undefined, name: string): Promise<void> {
  return clients.settings.deleteAgent({ cwd: cwd ?? '', name });
}

// ---- Settings: Subagent enabled ----

export async function getSubagentEnabled(
  cwd?: string
): Promise<{ enabled: boolean; source: string }> {
  return clients.settings.getSubagentEnabled({ cwd: cwd ?? '' });
}

export function setSubagentEnabled(enabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.setSubagentEnabled({ enabled, cwd: cwd ?? '' });
}

export function resetSubagentEnabled(cwd: string): Promise<void> {
  return clients.settings.resetSubagentEnabled({ cwd });
}

// ---- Settings: Skills ----

export function listSkills(
  _cwd?: string
): Promise<Array<{ name: string; description: string; disabled: boolean }>> {
  return clients.settings.listSkills() as any;
}

export function toggleSkill(name: string, enabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.toggleSkill({ name, enabled, cwd: cwd ?? '' });
}

// ---- Settings: Hooks ----

export function listHooks(cwd?: string): Promise<any[]> {
  return clients.settings.listHooks({ cwd: cwd ?? '' });
}

export function createHook(cwd: string | undefined, hook: Record<string, unknown>): Promise<void> {
  return clients.settings.createHook({ cwd: cwd ?? '', hook: hook as any });
}

export function updateHook(
  cwd: string | undefined,
  name: string,
  hook: Record<string, unknown>
): Promise<void> {
  return clients.settings.updateHook({ cwd: cwd ?? '', name, hook: hook as any });
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

export interface CheckpointDiff {
  turnId: number;
  files: Array<{
    path: string;
    status: string;
    diff: string;
    insertions: number;
    deletions: number;
  }>;
}

export interface CodeRollbackResult {
  reverted: boolean;
  throughTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
  restoreEntry: CodeRestoreEntry | null;
}

export interface CodeRollbackUndoResult {
  restored: boolean;
  conflict: boolean;
  conflictFiles: string[];
  restoredFiles: string[];
  remainingRolledBack: string[];
}

export interface RollbackPreviewDiff {
  throughTurnId: number;
  affectedTurns: number[];
  diff: string;
}

export interface CodeRestoreEntry {
  id: string;
  sessionId: string;
  action: string;
  throughTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
  safetyCommit: string;
  timestamp: string;
}

export interface SessionRollbackState {
  context: { active: boolean; currentThroughTurnId: number | null };
  code: {
    canUndoLast: boolean;
    lastEntry: CodeRestoreEntry | null;
    revertedFiles: string[];
    lastEntryId: string | null;
  };
}

export function getCheckpointDiff(
  sessionId: string,
  cwd: string,
  turnId?: number
): Promise<CheckpointDiff> {
  return clients.sessions.getCheckpointDiff({ sessionId, cwd, turnId }) as any;
}

export function revertCheckpointFile(
  sessionId: string,
  cwd: string,
  file: string
): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return clients.sessions.revertCheckpointFile({ sessionId, cwd, file }) as any;
}

export function revertCheckpointFiles(
  sessionId: string,
  cwd: string,
  files: string[]
): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return clients.sessions.revertCheckpointFiles({ sessionId, cwd, files }) as any;
}

export function previewRollbackDiff(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<RollbackPreviewDiff> {
  return clients.sessions.previewRollbackDiff({ sessionId, cwd, throughTurnId }) as any;
}

export function rollbackCodeToTurn(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return clients.sessions.rollbackCodeToTurn({ sessionId, cwd, throughTurnId }) as any;
}

export function rollbackContext(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{ ok: boolean; turns: any[]; rolledBackMessage?: string; promptEstimate?: number }> {
  return clients.sessions.rollbackContext({ sessionId, cwd, throughTurnId }) as any;
}

export function rollbackBothToTurn(
  sessionId: string,
  cwd: string,
  throughTurnId: number
): Promise<{
  ok: boolean;
  turns: any[];
  codeResult: CodeRollbackResult;
  rolledBackMessage?: string;
  promptEstimate?: number;
}> {
  return clients.sessions.rollbackBothToTurn({ sessionId, cwd, throughTurnId }) as any;
}

export function undoLastCodeRollback(
  sessionId: string,
  cwd: string,
  force?: boolean,
  files?: string[]
): Promise<{ ok: boolean; result: CodeRollbackUndoResult }> {
  return clients.sessions.undoLastCodeRollback({ sessionId, cwd, force, files }) as any;
}

export function getRollbackState(sessionId: string, cwd: string): Promise<SessionRollbackState> {
  return clients.sessions.getRollbackState({ sessionId, cwd }) as any;
}

export function forkSession(
  sessionId: string,
  cwd: string,
  atUuid?: string
): Promise<{ sessionId: string; turns: any[] }> {
  return clients.sessions.forkSession({ sessionId, cwd, atUuid });
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

export async function updateAutomation(id: string, data: UpdateAutomationInput): Promise<Automation> {
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
