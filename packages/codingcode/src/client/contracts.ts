import type { PermissionMode } from '../contracts/permission.js';
import type { ProfileName, TokenUsage } from '../contracts/types.js';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  RollbackPreviewDiff,
} from '../checkpoint/types.js';
import type { SelectableModel } from '../contracts/provider.js';
import type { McpServerConfig, McpStatus } from '../contracts/mcp.js';
import type { UserHookConfig } from '../contracts/hooks.js';
import type { SessionIndex, UITurn } from '../contracts/session.js';
import type { AVAILABLE_PROFILES } from '../agent/profile.js';
import type { Frame } from '../contracts/frame.js';

export type { TokenUsage, CheckpointDiff, CodeRollbackResult, RollbackPreviewDiff };

export type AvailableProfiles = typeof AVAILABLE_PROFILES;

export interface SessionProfileInfo {
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  cwd: string;
  available: AvailableProfiles;
}

export interface SessionPlanFile {
  content: string;
  path: string;
  directory: string;
  exists: boolean;
}

export interface RollbackContextResult {
  turns: UITurn[];
}

export interface RollbackBothResult {
  turns: UITurn[];
  codeResult: CodeRollbackResult;
}

export interface ForkResult {
  sessionId: string;
  turns: UITurn[];
}

export interface SessionClient {
  createSession(input: {
    cwd: string;
    activeProfile: ProfileName;
    permissionMode: PermissionMode;
    model: string;
  }): Promise<{ sessionId: string }>;
  resumeSession(input: { sessionId: string; cwd: string }): Promise<UITurn[]>;
  listSessions(input: { cwd: string }): Promise<SessionIndex[]>;
  getSessionHistory(input: { sessionId: string; cwd: string }): Promise<UITurn[]>;
  deleteSession(input: { sessionId: string; cwd: string }): Promise<void>;
  getSessionProfile(input: { sessionId: string; cwd: string }): Promise<SessionProfileInfo>;
  setSessionProfile(input: {
    sessionId: string;
    cwd: string;
    activeProfile: ProfileName;
  }): Promise<{ activeProfile: ProfileName; permissionMode: PermissionMode }>;
  getSessionPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setSessionPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
  getSessionPlan(input: { sessionId: string; cwd: string }): Promise<SessionPlanFile>;

  getCheckpointDiff(input: {
    sessionId: string;
    cwd: string;
    turnId?: number;
  }): Promise<CheckpointDiff>;
  revertCheckpointFiles(input: {
    sessionId: string;
    cwd: string;
    files: string[];
  }): Promise<CodeRollbackResult>;
  previewRollbackDiff(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<RollbackPreviewDiff>;
  rollbackCodeToTurn(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<CodeRollbackResult>;
  rollbackContext(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<RollbackContextResult>;
  rollbackBothToTurn(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<RollbackBothResult>;
  forkSession(input: {
    sessionId: string;
    cwd: string;
    atTurnId?: number;
  }): Promise<ForkResult>;
}

export interface AgentRuntimeClient {
  sendMessage(
    input: string,
    options: { sessionId?: string; cwd: string; signal?: AbortSignal }
  ): AsyncGenerator<Frame>;

  sendApprovalResponse(input: {
    sessionId: string;
    approvalId: string;
    response: string;
  }): Promise<void>;
  compact(input: { sessionId: string; cwd: string }): Promise<void>;
}

export interface ModelClient {
  listModels(): Promise<{ models: SelectableModel[]; activeId: string | null }>;
  switchModel(input: { id: string }): Promise<void>;
}

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{ enabled: boolean; model: string }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryModel(model: string): Promise<{ model: string }>;
  getAgentConfig(): Promise<{ maxSteps: number; maxStopContinuations: number }>;
  setCompactionModel(compactionModel: string): Promise<{ compactionModel: string }>;
  getMcpStatus(input: { cwd: string }): Promise<McpStatus[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; skillPath: string }>>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  getGlobalPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setGlobalPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
}
