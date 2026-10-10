import type {
  Automation,
  CheckpointDiff,
  CodeRollbackResult,
  CreateAutomationInput,
  McpServerConfig,
  McpServerEntry,
  RollbackPreviewDiff,
  RunAutomationResult,
  SelectableModel,
  SessionSummary,
  UITurn,
  UpdateAutomationInput,
  UserHookConfig,
} from './dto.js';
import type { PermissionMode, ProfileName, TokenUsage } from './types.js';
import type { Frame } from './protocol.js';

export interface SessionProfileInfo {
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  cwd: string;
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
  listSessions(input: { cwd: string }): Promise<SessionSummary[]>;
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
  renameSession(input: { sessionId: string; cwd: string; title: string }): Promise<void>;
  getSessionPlan(input: { sessionId: string; cwd: string }): Promise<SessionPlanFile>;
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
  /** sessionId 为空时切全局默认模型（写 config.yaml），否则只写该会话头文件 */
  setSessionModel(input: {
    sessionId?: string | null;
    cwd: string;
    model: string;
  }): Promise<void>;
}

/**
 * 输入内容部件的线上形状：文本或媒体。
 *
 * 媒体随 base64 data URL 内联在同一个请求里 —— 新会话的请求 id 是 `_`，
 * 那一刻还没有 sessionId、资产无处安放。
 */
export type InputPart =
  | { type: 'text'; text: string }
  | { type: 'media'; dataUrl: string; filename?: string };

/**
 * 单个媒体附件的字节上限，与服务端准入闸口
 * `packages/codingcode/src/session/assets.ts` 的 `MAX_MEDIA_BYTES` 同值同义。
 * 前端只用它做提交前的 UX 早退，最终准入以服务端校验为准。
 */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export interface AgentRuntimeClient {
  /**
   * 提交一轮输入。
   *
   * 命中活跃回合时服务端把输入并入当前回合（202），返回 `{ kind: 'queued' }`；
   * 否则开新回合并返回 `{ kind: 'turn', stream }`。
   */
  submitInput(
    input: InputPart[],
    options: {
      sessionId?: string;
      /** 前端队列项 id：命中活跃回合时原样回显在 user_input 帧上 */
      inputId?: string;
      cwd: string;
      model?: string;
      signal?: AbortSignal;
      /** 用户在输入框显式 @ 的 skill，name 供对齐、path 为唯一查找键 */
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
  /** model 为空时用全局默认模型压缩 */
  compact(input: { sessionId: string; cwd: string; model?: string }): Promise<CompressResult>;
}

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ModelClient {
  listModels(): Promise<{ models: SelectableModel[]; activeId: string }>;
}

/** config.yaml 的 agent 配置投影。activeProfile / permissionMode 只在会话尚未创建时生效。 */
export interface AgentConfigView {
  maxSteps: number;
  maxStopContinuations: number;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
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
    activeProfile?: ProfileName;
    permissionMode?: PermissionMode;
  }): Promise<AgentConfigView>;
  setCompactionModel(compactionModel: string): Promise<{ compactionModel: string }>;
  getMcpStatus(input: { cwd: string }): Promise<McpServerEntry[]>;
  setMcpEnabled(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(input: { cwd: string }): Promise<Array<{ name: string; description: string; skillPath: string }>>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
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

/** 定时任务的增删改查与立即执行。 */
export interface AutomationClient {
  listAutomations(): Promise<Automation[]>;
  createAutomation(input: CreateAutomationInput): Promise<Automation>;
  updateAutomation(id: string, patch: UpdateAutomationInput): Promise<Automation>;
  deleteAutomation(id: string): Promise<void>;
  /** 不等下个 cron 点，立即跑一次，返回新建的会话 id。 */
  runAutomationOnce(id: string): Promise<RunAutomationResult>;
}
