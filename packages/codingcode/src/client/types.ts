import type { PermissionMode } from '../approval/types.js';
import type { McpServerConfig, McpStatus } from '../mcp/types.js';
import type { AgentProfile } from '../subagent/types.js';
import type { UserHookConfig } from '../hooks/types.js';
import type { SessionEvent, SessionIndex } from '../session/types.js';
import type { SelectableModel } from '../llm/factory.js';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
  RollbackPreviewDiff,
  RollbackState,
} from '../checkpoint/types.js';

export type StreamChunk =
  | { type: 'session_id'; sessionId: string }
  | { type: 'turn_id'; turnId: number }
  | { type: 'text'; text: string; messageId?: number }
  | { type: 'message'; id: number; content: string; partial: false }
  | {
      type: 'approval_request';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  | { type: 'plan_ready'; sessionId: string; title: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; ok: boolean }
  | { type: 'tool_denied'; id: string; name: string; reason: string }
  | { type: 'error'; message: string; code: string }
  | { type: 'done' }
  | { type: 'todo_update'; items: ReadonlyArray<{ step: string; status: string }> }
  | { type: 'usage'; prompt: number; completion: number; total: number }
  | { type: 'reactive_compact'; released: number; promptEstimate: number };

export interface AgentClient {
  sendMessage(input: string, cwd?: string): AsyncGenerator<StreamChunk>;
  sendApprovalResponse(id: string, response: string): Promise<void>;
  resumeSession(sid: string): Promise<SessionEvent[]>;
  listSessions(): Promise<SessionIndex[]>;
  listModels(): Promise<{ models: SelectableModel[]; activeId: string | null }>;
  switchModel(id: string): Promise<void>;
  getSessionId(): string;
  getCheckpoints(): Promise<Array<{ turnId: number; title: string; files: string[] }>>;
  getCheckpointDiff(turnId?: number): Promise<CheckpointDiff>;
  revertCheckpointFiles(turnId: number, files: string[]): Promise<CodeRollbackResult>;
  previewRollbackDiff(throughTurnId: number): Promise<RollbackPreviewDiff>;
  rollbackCodeToTurn(throughTurnId: number): Promise<CodeRollbackResult>;
  rollbackContext(
    throughTurnId: number
  ): Promise<{ turns: SessionEvent[]; rollbackState: RollbackState }>;
  rollbackBothToTurn(throughTurnId: number): Promise<{
    turns: SessionEvent[];
    codeResult: CodeRollbackResult;
    rollbackState: RollbackState;
  }>;
  undoLastCodeRollback(force?: boolean, files?: string[]): Promise<CodeRollbackUndoResult>;
  getRollbackState(): Promise<RollbackState>;
  forkSession(atTurnId?: number): Promise<string>;
  compact(): Promise<void>;
  getMemoryEnabled(): Promise<boolean>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  getMemoryConfig(): Promise<{
    enabled: boolean;
    types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
  }>;
  setTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addExtraType(type: { name: string; description: string }): Promise<void>;
  updateExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteExtraType(name: string): Promise<void>;
  getSubagentEnabled(query: { cwd: string }): Promise<{ enabled: boolean; source: string }>;
  setSubagentEnabled(body: { enabled: boolean; cwd: string }): Promise<void>;
  resetSubagentEnabled(body: { cwd: string }): Promise<void>;
  getMcpStatus(query: { cwd: string }): Promise<McpStatus[]>;
  createMcpServer(server: McpServerConfig, query: { cwd: string }): Promise<void>;
  updateMcpServer(name: string, server: McpServerConfig, query: { cwd: string }): Promise<void>;
  deleteMcpServer(name: string, query: { cwd: string }): Promise<void>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  listAgents(query: { cwd: string }): Promise<
    Array<{
      name: string;
      description: string;
      tools?: string[];
      mcpServers?: string[];
      readonly?: boolean;
      maxSteps?: number;
      model?: string;
      disabled?: boolean;
    }>
  >;
  createAgent(profile: AgentProfile, query: { cwd: string }): Promise<void>;
  updateAgent(name: string, profile: AgentProfile, query: { cwd: string }): Promise<void>;
  deleteAgent(name: string, query: { cwd: string }): Promise<void>;
  setAgentDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetAgentDisabled(body: { name: string; cwd: string }): Promise<void>;
  listHooks(query: { cwd: string }): Promise<UserHookConfig[]>;
  setHookDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  createHook(hook: UserHookConfig, query: { cwd: string }): Promise<void>;
  updateHook(name: string, hook: UserHookConfig, query: { cwd: string }): Promise<void>;
  deleteHook(name: string, query: { cwd: string }): Promise<void>;
  getPermissionMode(): Promise<PermissionMode>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}
