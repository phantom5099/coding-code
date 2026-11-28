/**
 * DTO 层：全部从 core 各领域包 type-only re-export，零复制定义、零运行时依赖。
 */
export type {
  StoredMediaPart,
  StoredPart,
  SessionSummary,
  UITurn,
  UITurnItem,
} from '@codingcode/session';
export type {
  CheckpointDiff,
  CodeRollbackResult,
  RollbackPreviewDiff,
} from '@codingcode/checkpoint';
export type { CompressResult } from '@codingcode/context';
export type { SelectableModel } from '@codingcode/model';
export type { McpServerConfig, McpServerEntry } from '@codingcode/mcp';
export type { HookConfigEntry, HookPoint, UserHookConfig } from '@codingcode/hook';
export type {
  Automation,
  AutomationSandbox,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@codingcode/scheduler';
export type {
  AgentConfigView,
  ForkResult,
  RollbackBothResult,
  RollbackContextResult,
  RunAutomationResult,
  SkillEntry,
  WireInputPart as InputPart,
} from '@codingcode/http';
