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
