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
  InputPart,
} from './contracts.js';

/** 纯媒体原语（零 effect、零 Node 运行时依赖），与服务端准入同源 */
export {
  ACCEPTED_MEDIA_MIMES,
  MAX_MEDIA_BYTES,
  mediaKindOf,
  textOf,
  textPart,
  type AcceptedMediaMime,
  type MediaKind,
  type TextPart,
} from '@codingcode/util/media';

/** 纯 Hook 点位常量（零 effect、零 Node 运行时依赖），与服务端同源 */
export { HOOK_POINT } from '@codingcode/hook/types';

export type {
  AgentRuntimeClient,
  SessionClient,
  ModelClient,
  SettingsClient,
  AutomationClient,
  AgentConfigView,
  InputPart,
};

export type {
  RollbackContextResult,
  RollbackBothResult,
  ForkResult,
  CompressResult,
  RunAutomationResult,
  SkillEntry,
} from './contracts.js';

export type {
  Automation,
  AutomationSandbox,
  CheckpointDiff,
  CodeRollbackResult,
  CreateAutomationInput,
  HookConfigEntry,
  HookPoint,
  McpServerConfig,
  McpServerEntry,
  RollbackPreviewDiff,
  SelectableModel,
  SessionSummary,
  StoredMediaPart,
  StoredPart,
  UITurn,
  UITurnItem,
  UpdateAutomationInput,
  UserHookConfig,
} from './dto.js';

export type { PermissionMode, TodoItem, TodoStatus, TokenUsage } from './types.js';

export type {
  Envelope,
  ApprovalAction,
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
