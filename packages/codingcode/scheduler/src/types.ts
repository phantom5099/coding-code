import type { SandboxMode } from '@codingcode/sandbox';

export type AutomationSandbox = Extract<SandboxMode, 'read-only' | 'workspace-write'>;

export interface AutomationSpec {
  name: string;
  description: string;
  cron: string;
  timezone: string;
  sandbox: AutomationSandbox;
  projectCwd: string;
  runOnce: boolean;
}

export interface Automation extends AutomationSpec {
  id: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastSessionId: string | null;
}

export interface CreateAutomationInput {
  readonly name: string;
  readonly description: string;
  readonly cron: string;
  readonly timezone?: string;
  readonly sandbox?: AutomationSandbox;
  readonly projectCwd: string;
  readonly runOnce?: boolean;
}

export interface UpdateAutomationInput {
  readonly name?: string;
  readonly description?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly sandbox?: AutomationSandbox;
  readonly enabled?: boolean;
  readonly runOnce?: boolean;
}
