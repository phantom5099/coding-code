import { Layer } from 'effect';
import { AgentService } from './agent/agent';
import { SessionService } from './session/store';
import { ContextService } from './context/context';
import { HookService } from './hooks/registry';
import { McpService } from './mcp/index';
import { SkillService } from './skills/index';
import { ApprovalService } from './approval/index';
import { ApprovalWaitService } from './approval/async-confirm';
import { ToolExecutorService } from './tools/executor';
import { CheckpointService } from './checkpoint/checkpoint-service';
import { ToolSearchService } from './tools/tool-search-service';
import { SubagentRegistry } from './subagent/registry';
import { ProjectRuntimeService } from './runtime/project-runtime';

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
  ProjectRuntimeLayer
);
