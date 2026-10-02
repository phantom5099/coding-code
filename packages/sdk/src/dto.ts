import type { PermissionMode, ProfileName, TokenUsage } from './types.js';

export interface SessionSummary {
  type: 'session_meta';
  sessionId: string;
  cwd: string;
  createdAt: string;
  model: string;
  title: string;
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  parentSessionId?: string;
  agentName?: string;
  updatedAt: string;
  usage?: TokenUsage;
}

export type UITurnItem =
  | { id: string; type: 'message'; role: 'user' | 'assistant'; content: string; partial?: boolean }
  | {
      id: string;
      type: 'tool_call';
      name: string;
      args: Record<string, unknown>;
      status: 'pending' | 'approved' | 'rejected' | 'running';
    }
  | {
      id: string;
      type: 'tool_result';
      callId: string;
      name: string;
      output: string;
      exitCode?: number;
      filePath?: string;
      diff?: string;
      insertions?: number;
      deletions?: number;
    }
  | {
      id: string;
      type: 'summary';
      content: string;
      startTurnId: number;
      endTurnId: number;
    }
  | { id: string; type: 'reasoning'; content: string; isVisible: boolean }
  | { id: string; type: 'error'; message: string; code?: string };

export interface UITurn {
  id: string;
  items: UITurnItem[];
  status: 'running' | 'completed' | 'error';
}

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
}

export interface RollbackPreviewDiff {
  throughTurnId: number;
  affectedTurns: number[];
  diff: string;
}

export interface SelectableModel {
  id: string;
  provider: string;
  driver: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
  context_window: number;
}

export interface McpServerConfig {
  name: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  concurrency?: number;
  autoReconnect?: boolean;
}

/** GET /api/settings/mcp 的响应项：MCP 配置 + 启用态与来源 */
export interface McpServerEntry extends McpServerConfig {
  enabled: boolean;
  source: 'global' | 'project';
  hasProjectOverride?: boolean;
}

export type HookPoint =
  | 'tool.execute.before'
  | 'tool.execute.after'
  | 'tool.execute.error'
  | 'tool.approval.pre'
  | 'tool.approval.post'
  | 'agent.turn.start'
  | 'agent.step.before'
  | 'agent.turn.stop'
  | 'agent.turn.end'
  | 'agent.subagent.spawn.before'
  | 'agent.subagent.spawn.after'
  | 'agent.subagent.complete';

export interface UserHookConfig {
  name: string;
  description?: string;
  point: HookPoint;
  type: 'observer' | 'decision';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  enabled?: boolean;
}

export type AutomationSandbox = 'readonly' | 'workspace-write';

export interface Automation {
  id: string;
  name: string;
  description: string;
  cron: string;
  timezone: string;
  sandbox: AutomationSandbox;
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
  sandbox?: AutomationSandbox;
  projectCwd: string;
  runOnce?: boolean;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  cron?: string;
  timezone?: string;
  sandbox?: AutomationSandbox;
  enabled?: boolean;
  runOnce?: boolean;
}

export interface RunAutomationResult {
  sessionId: string;
}
