import { API_BASE } from './api';
import {
  createHttpClients,
  type AgentConfigView,
  type AgentRuntimeClient,
  type Automation,
  type CheckpointDiff,
  type CodeRollbackResult,
  type CreateAutomationInput,
  type McpServerConfig,
  type McpServerEntry,
  type PermissionMode,
  type ProfileName,
  type RollbackPreviewDiff,
  type RunAutomationResult,
  type TokenUsage,
  type UITurn,
  type UpdateAutomationInput,
  type UserHookConfig,
} from '@codingcode/sdk';

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

export function setSessionModel(
  sessionId: string | null,
  cwd: string,
  model: string
): Promise<void> {
  return clients.sessions.setSessionModel({ sessionId, cwd, model });
}

// ---- Compaction ----

export function compactSession(
  sessionId: string,
  cwd: string,
  model?: string
): Promise<{ didCompress: boolean; released: number; promptEstimate: number }> {
  return clients.agent.compact({ sessionId, cwd, model });
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

export function renameSession(sessionId: string, cwd: string, title: string): Promise<void> {
  return clients.sessions.renameSession({ sessionId, cwd, title });
}

/** 停掉该会话下仍在跑的后台子代理（「停止全部」按钮），返回停掉的数量 */
export function stopAllSubagents(sessionId: string): Promise<{ stopped: number }> {
  return clients.sessions.stopAllSubagents({ sessionId });
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

export function getAgentConfig(): Promise<AgentConfigView> {
  return clients.settings.getAgentConfig();
}

export function setAgentConfig(partial: {
  maxSteps?: number;
  maxStopContinuations?: number;
  activeProfile?: ProfileName;
  permissionMode?: PermissionMode;
}): Promise<AgentConfigView> {
  return clients.settings.setAgentConfig(partial);
}

// ---- Settings: Context config ----

export async function setCompactionModel(
  compactionModel: string
): Promise<{ compactionModel: string }> {
  return clients.settings.setCompactionModel(compactionModel);
}

// ---- Settings: MCP ----

export function listMcpServers(cwd?: string): Promise<McpServerEntry[]> {
  return clients.settings.getMcpStatus({ cwd: cwd ?? '' });
}

export function setMcpEnabled(name: string, enabled: boolean, cwd?: string): Promise<void> {
  return clients.settings.setMcpEnabled({ name, enabled, cwd: cwd ?? '' });
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

export function listSkills(cwd?: string): Promise<
  Array<{
    name: string;
    description: string;
    skillPath: string;
    source?: 'global' | 'project';
  }>
> {
  return clients.settings.listSkills({ cwd: cwd ?? '' });
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

export function setHookEnabled(
  cwd: string | undefined,
  name: string,
  enabled: boolean
): Promise<void> {
  return clients.settings.setHookEnabled({ cwd: cwd ?? '', name, enabled });
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

export function listAutomations(): Promise<Automation[]> {
  return clients.automations.listAutomations();
}

export function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  return clients.automations.createAutomation(input);
}

export function updateAutomation(id: string, input: UpdateAutomationInput): Promise<Automation> {
  return clients.automations.updateAutomation(id, input);
}

export function deleteAutomation(id: string): Promise<void> {
  return clients.automations.deleteAutomation(id);
}

export function runAutomationOnce(id: string): Promise<RunAutomationResult> {
  return clients.automations.runAutomationOnce(id);
}
