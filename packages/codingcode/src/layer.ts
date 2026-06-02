import { Layer } from 'effect';
import { AgentService } from './agent/agent';
import { SessionService } from './session/store';
import { ContextService } from './context/context';
import { ToolService } from './tools/registry';
import { HookService } from './hooks/registry';
import { McpService } from './mcp/index';
import { SkillService } from './skills/index';
import { ApprovalService } from './approval/index';
import { ApprovalWaitService } from './approval/async-confirm';
import { ToolExecutorService } from './tools/executor';
import { CheckpointService } from './checkpoint/checkpoint-service';
import { ToolSearchService } from './tools/tool-search-service';
import { SubagentRegistry } from './subagent/registry';

export const AgentLayer = AgentService.Default;
export const SessionLayer = SessionService.Default;
export const ContextLayer = ContextService.Default;
export const ToolLayer = ToolService.Default;
export const HookLayer = HookService.Default;
export const SkillLayer = SkillService.Default;
export const ApprovalWaitLayer = ApprovalWaitService.Default;
export const SubagentRegistryLayer = SubagentRegistry.Default;
/** ApprovalService depends on HookService + ApprovalWaitService — provide them eagerly. */
export const ApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer)),
);

/** Layer providing all infrastructure services. */
const InfraLayer = Layer.mergeAll(ToolLayer, HookLayer);

/** MCP depends on ToolLayer + HookLayer. */
export const McpLayer = McpService.Default.pipe(Layer.provide(InfraLayer));

/** ToolExecutor depends on ToolLayer + HookLayer + ApprovalLayer. */
const ExecutorDeps = Layer.mergeAll(
  ToolLayer,
  HookLayer,
  ApprovalLayer,
);
const ExecutorLayer = ToolExecutorService.Default.pipe(
  Layer.provide(ExecutorDeps),
);

/** Checkpoint depends on HookService (for bootstrap observers). */
const CheckpointDeps = Layer.mergeAll(HookLayer);
export const CheckpointLayer = CheckpointService.Default.pipe(
  Layer.provide(CheckpointDeps),
);

export const ToolSearchLayer = ToolSearchService.Default.pipe(
  Layer.provide(ToolLayer),
);

/** Agent depends on ToolExecutor + ToolService + ContextService + SessionService + CheckpointService + ToolSearchService + SubagentRegistryLayer. */
const AgentDeps = Layer.mergeAll(
  ExecutorLayer, ToolLayer, ContextLayer, SessionLayer, CheckpointLayer,
  ToolSearchLayer, SubagentRegistryLayer, HookLayer,
);
const AgentWithDeps = AgentLayer.pipe(Layer.provide(AgentDeps));

/** Final application layer — all services merged. */
export const AppLayer = Layer.mergeAll(
  AgentWithDeps,
  ExecutorLayer,
  SessionLayer,
  ContextLayer,
  InfraLayer,
  McpLayer,
  SkillLayer,
  ApprovalLayer,
  ApprovalWaitLayer,
  CheckpointLayer,
  ToolSearchLayer,
  SubagentRegistryLayer,
);
