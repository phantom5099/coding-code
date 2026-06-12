import { Layer } from 'effect';
import { AgentService } from './agent/agent.js';
import { SessionService } from './session/store.js';
import { HookService } from './hooks/registry.js';
import { McpService } from './mcp/index.js';
import { SkillService } from './skills/service.js';
import { ApprovalService } from './approval/index.js';
import { ApprovalWaitService } from './approval/async-confirm.js';
import { ToolExecutorService } from './tools/executor.js';
import { CheckpointService } from './checkpoint/checkpoint-service.js';
import { ProjectRuntimeService } from './runtime/project-runtime.js';
import { LLMFactoryService } from './llm/factory.js';

export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const HookLayer = HookService.Default;
export const SkillLayer = SkillService.Default;
export const CheckpointLayer = CheckpointService.Default;
export const ApprovalWaitLayer = ApprovalWaitService.Default;
export const McpLayer = McpService.Default;
export const ProjectRuntimeLayer = ProjectRuntimeService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, McpLayer))
);
export const LLMFactoryLayer = LLMFactoryService.Default;
export const ApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer))
);

/** ToolExecutor depends on HookLayer + ApprovalLayer. */
const ExecutorDeps = Layer.mergeAll(HookLayer, ApprovalLayer);
const ExecutorLayer = ToolExecutorService.Default.pipe(Layer.provide(ExecutorDeps));

/** Agent depends on ToolExecutor + HookLayer + ApprovalLayer + ApprovalWaitLayer + Session + Checkpoint + ProjectRuntime + Skill. */
const AgentDeps = Layer.mergeAll(
  ExecutorLayer,
  ApprovalLayer,
  ApprovalWaitLayer,
  SessionLayer,
  CheckpointLayer,
  McpLayer,
  SkillLayer,
  LLMFactoryLayer,
  HookLayer,
  ProjectRuntimeLayer
);
const AgentWithDeps = AgentLayer.pipe(Layer.provide(AgentDeps));

/** Final application layer — all services merged. */
export const AppLayer = Layer.mergeAll(
  AgentWithDeps,
  ExecutorLayer,
  SessionLayer,
  HookLayer,
  McpLayer,
  SkillLayer,
  ApprovalLayer,
  ApprovalWaitLayer,
  CheckpointLayer,
  ProjectRuntimeLayer,
  LLMFactoryLayer,
);
