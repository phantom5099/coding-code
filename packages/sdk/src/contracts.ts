import type {
  AgentConfigView,
  Automation,
  CheckpointDiff,
  CodeRollbackResult,
  CompressResult,
  CreateAutomationInput,
  ForkResult,
  HookConfigEntry,
  InputPart,
  McpServerConfig,
  McpServerEntry,
  RollbackBothResult,
  RollbackContextResult,
  RollbackPreviewDiff,
  RunAutomationResult,
  SelectableModel,
  SessionSummary,
  SkillEntry,
  UITurn,
  UpdateAutomationInput,
  UserHookConfig,
} from './dto.js';
import type { PermissionMode } from './types.js';
import type { Frame } from './protocol.js';

export type {
  AgentConfigView,
  CompressResult,
  ForkResult,
  InputPart,
  RollbackBothResult,
  RollbackContextResult,
  RunAutomationResult,
  SkillEntry,
};

export interface SessionClient {
  createSession(input: {
    cwd: string;
    permissionMode: PermissionMode;
    model: string;
  }): Promise<{ sessionId: string }>;
  resumeSession(input: { sessionId: string; cwd: string }): Promise<UITurn[]>;
  listSessions(input: { cwd: string }): Promise<SessionSummary[]>;
  getSessionHistory(input: { sessionId: string; cwd: string }): Promise<UITurn[]>;
  deleteSession(input: { sessionId: string; cwd: string }): Promise<void>;
  getSessionPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setSessionPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
  renameSession(input: { sessionId: string; cwd: string; title: string }): Promise<void>;
  stopAllSubagents(input: { sessionId: string }): Promise<{ stopped: number }>;

  getCheckpointDiff(input: {
    sessionId: string;
    cwd: string;
    turnId?: number;
  }): Promise<CheckpointDiff>;
  revertCheckpointFiles(input: {
    sessionId: string;
    cwd: string;
    files: string[];
    turnId?: number;
  }): Promise<CodeRollbackResult>;
  undoRollback(input: {
    sessionId: string;
    cwd: string;
    files: string[];
  }): Promise<CodeRollbackResult>;
  previewRollbackDiff(input: {
    sessionId: string;
    cwd: string;
    throughTurnId: number;
  }): Promise<RollbackPreviewDiff>;
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
  /** sessionId 为空时切全局默认模型（写 config.yaml），否则只写该会话头文件 */
  setSessionModel(input: {
    sessionId?: string | null;
    cwd: string;
    model: string;
  }): Promise<void>;
}

export interface AgentRuntimeClient {
  submitInput(
    input: InputPart[],
    options: {
      sessionId?: string;
      inputId?: string;
      cwd: string;
      model?: string;
      signal?: AbortSignal;
      skills?: Array<{ name: string; path: string }>;
    }
  ): Promise<
    | { kind: 'turn'; stream: AsyncGenerator<Frame> }
    | { kind: 'queued'; sessionId: string; turnId: number }
  >;

  sendApprovalResponse(input: {
    sessionId: string;
    approvalId: string;
    response: string;
  }): Promise<void>;
  sendAskUserAnswer(input: {
    sessionId: string;
    askId: string;
    options?: string[];
    custom?: string;
  }): Promise<void>;
  compact(input: { sessionId: string; cwd: string; model?: string }): Promise<CompressResult>;
}

export interface ModelClient {
  listModels(): Promise<{ models: SelectableModel[]; activeId: string }>;
}

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{ enabled: boolean; model: string }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryModel(model: string): Promise<{ model: string }>;
  getAgentConfig(): Promise<AgentConfigView>;
  setAgentConfig(patch: {
    maxSteps?: number;
    maxStopContinuations?: number;
    permissionMode?: PermissionMode;
  }): Promise<AgentConfigView>;
  setCompactionModel(compactionModel: string): Promise<{ compactionModel: string }>;
  getMcpStatus(input: { cwd: string }): Promise<McpServerEntry[]>;
  setMcpEnabled(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(input: { cwd: string }): Promise<SkillEntry[]>;
  listHooks(input: { cwd: string }): Promise<HookConfigEntry[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookEnabled(input: { cwd: string; name: string; enabled: boolean }): Promise<void>;
  getGlobalPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setGlobalPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
}

export interface AutomationClient {
  listAutomations(): Promise<Automation[]>;
  createAutomation(input: CreateAutomationInput): Promise<Automation>;
  updateAutomation(id: string, patch: UpdateAutomationInput): Promise<Automation>;
  deleteAutomation(id: string): Promise<void>;
  runAutomationOnce(id: string): Promise<RunAutomationResult>;
}
