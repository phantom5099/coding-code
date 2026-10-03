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

export type AutomationSandbox = 'readonly' | 'workspace-write';

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
