import { Layer } from 'effect';
import { AgentService } from './agent/agent.js';
import { SessionService } from './session/store.js';
import { ContextService } from './context/context.js';
import { HookService } from './hooks/registry.js';
import { McpService } from './mcp/index.js';
import { SkillService } from './skills/service.js';
import { ApprovalService } from './approval/index.js';
import { ApprovalWaitService } from './approval/async-confirm.js';
import { ToolExecutorService } from './tools/executor.js';
import { CheckpointService } from './checkpoint/checkpoint-service.js';
import { ToolSearchService } from './tools/tool-search-service.js';
import { SubagentRegistry } from './subagent/registry.js';
import { ProjectRuntimeService } from './runtime/project-runtime.js';
import { SchedulerService } from './scheduler/service.js';

export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const ContextLayer = ContextService.Default;
export const HookLayer = HookService.Default;
export const SkillLayer = SkillService.Default;
export const ApprovalWaitLayer = ApprovalWaitService.Default;
export const SubagentRegistryLayer = SubagentRegistry.Default;
export const McpLayer = McpService.Default;
export const ApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer))
);

/** ProjectRuntime depends on HookService + McpService. */
const ProjectRuntimeDeps = Layer.mergeAll(HookLayer, McpLayer);
export const ProjectRuntimeLayer = ProjectRuntimeService.Default.pipe(
  Layer.provide(ProjectRuntimeDeps)
);

/** ToolExecutor depends on HookLayer + ApprovalLayer. */
const ExecutorDeps = Layer.mergeAll(HookLayer, ApprovalLayer);
const ExecutorLayer = ToolExecutorService.Default.pipe(Layer.provide(ExecutorDeps));

/** Checkpoint depends on HookService (for bootstrap observers). */
const CheckpointDeps = Layer.mergeAll(HookLayer);
export const CheckpointLayer = CheckpointService.Default.pipe(Layer.provide(CheckpointDeps));

export const ToolSearchLayer = ToolSearchService.Default;

/** Scheduler depends on SessionService. */
export const SchedulerLayer = SchedulerService.Default.pipe(
  Layer.provide(SessionLayer)
);

/** Agent depends on ToolExecutor + ContextService + SessionService + CheckpointService + ToolSearchService + HookLayer + ProjectRuntime. */
const AgentDeps = Layer.mergeAll(
  ExecutorLayer,
  ContextLayer,
  SessionLayer,
  CheckpointLayer,
  ToolSearchLayer,
  HookLayer,
  ProjectRuntimeLayer
);
const AgentWithDeps = AgentLayer.pipe(Layer.provide(AgentDeps));

/** Final application layer — all services merged. */
export const AppLayer = Layer.mergeAll(
  AgentWithDeps,
  ExecutorLayer,
  SessionLayer,
  ContextLayer,
  HookLayer,
  McpLayer,
  SkillLayer,
  ApprovalLayer,
  ApprovalWaitLayer,
  CheckpointLayer,
  ToolSearchLayer,
  SubagentRegistryLayer,
  ProjectRuntimeLayer,
  SchedulerLayer
);
