import type { PermissionMode } from '../approval/types.js';
import type { McpServerConfig, McpStatus } from '../mcp/types.js';
import type { AgentProfile } from '../subagent/registry.js';
import type { UserHookConfig } from '../hooks/config.js';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
  RollbackPreviewDiff,
} from '../checkpoint/checkpoint-service.js';

export type StreamChunk =
  | { type: 'session_id'; sessionId: string }
  | { type: 'turn_id'; turnId: number }
  | { type: 'text'; text: string; messageId?: number }
  | { type: 'message'; id: number; content: string; partial: false }
  | { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }
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
  resumeSession(sid: string): Promise<any>;
  listSessions(): Promise<any[]>;
  listModels(): Promise<any>;
  switchModel(id: string): Promise<void>;
  getSessionId(): string;
  getCheckpoints(): Promise<
    Array<{ turnId: number; title: string; files: string[] }>
  >;
  getCheckpointDiff(turnId?: number): Promise<CheckpointDiff>;
  revertCheckpointFile(turnId: number, file: string): Promise<CodeRollbackResult>;
  revertCheckpointFiles(turnId: number, files: string[]): Promise<CodeRollbackResult>;
  previewRollbackDiff(throughTurnId: number): Promise<RollbackPreviewDiff>;
  rollbackCodeToTurn(throughTurnId: number): Promise<CodeRollbackResult>;
  rollbackContext(throughTurnId: number): Promise<{ turns: any[]; rollbackState: any }>;
  rollbackBothToTurn(
    throughTurnId: number
  ): Promise<{ turns: any[]; codeResult: CodeRollbackResult; rollbackState: any }>;
  undoLastCodeRollback(force?: boolean, files?: string[]): Promise<CodeRollbackUndoResult>;
  getRollbackState(): Promise<any>;
  forkSession(atUuid?: string): Promise<string>;
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
  getMcpStatus(): Promise<McpStatus[]>;
  createMcpServer(server: McpServerConfig): Promise<void>;
  updateMcpServer(name: string, server: McpServerConfig): Promise<void>;
  deleteMcpServer(name: string): Promise<void>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  listAgents(): Promise<
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
  createAgent(profile: AgentProfile): Promise<void>;
  updateAgent(name: string, profile: AgentProfile): Promise<void>;
  deleteAgent(name: string): Promise<void>;
  setAgentDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetAgentDisabled(body: { name: string; cwd: string }): Promise<void>;
  listHooks(): Promise<UserHookConfig[]>;
  setHookDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  createHook(hook: UserHookConfig): Promise<void>;
  updateHook(name: string, hook: UserHookConfig): Promise<void>;
  deleteHook(name: string): Promise<void>;
  getPermissionMode(): Promise<PermissionMode>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}
