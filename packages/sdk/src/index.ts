import { createRequestHelpers } from './http/request.js';
import { createHttpAgentClient } from './http/agent-runtime.js';
import { createHttpSessionClient } from './http/sessions.js';
import { createHttpModelClient } from './http/models.js';
import { createHttpSettingsClient } from './http/settings.js';
import { createHttpAutomationClient } from './http/automations.js';
import type {
  AgentRuntimeClient,
  SessionClient,
  ModelClient,
  SettingsClient,
  AutomationClient,
  AgentConfigView,
} from './contracts.js';

export type {
  AgentRuntimeClient,
  SessionClient,
  ModelClient,
  SettingsClient,
  AutomationClient,
  AgentConfigView,
};

export type {
  SessionProfileInfo,
  SessionPlanFile,
  RollbackContextResult,
  RollbackBothResult,
  ForkResult,
  CompressResult,
} from './contracts.js';

export type {
  Automation,
  AutomationSandbox,
  CheckpointDiff,
  CodeRollbackResult,
  CreateAutomationInput,
  HookPoint,
  McpServerConfig,
  McpServerEntry,
  RollbackPreviewDiff,
  RunAutomationResult,
  SelectableModel,
  SessionSummary,
  UITurn,
  UITurnItem,
  UpdateAutomationInput,
  UserHookConfig,
} from './dto.js';

export type {
  AvailableProfile,
  AvailableProfiles,
  PermissionMode,
  ProfileName,
  TodoItem,
  TodoStatus,
  TokenUsage,
} from './types.js';

export type {
  Envelope,
  Frame,
  FrameBody,
  FrameError,
  RuntimeEvent,
  ToolOutcome,
  Transition,
} from './protocol.js';

export { ApiError } from './error.js';

export interface HttpClients {
  agent: AgentRuntimeClient;
  sessions: SessionClient;
  models: ModelClient;
  settings: SettingsClient;
  automations: AutomationClient;
}

export function createHttpClients(baseUrl: string): HttpClients {
  const request = createRequestHelpers(baseUrl);
  return {
    agent: createHttpAgentClient(baseUrl, request),
    sessions: createHttpSessionClient(request),
    models: createHttpModelClient(request),
    settings: createHttpSettingsClient(request),
    automations: createHttpAutomationClient(request),
  };
}
