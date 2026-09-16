import { Layer, ManagedRuntime } from 'effect';
import { HookLayer } from './hooks/hooks.js';
import { RulesLayer } from './rules/rules.js';
import { SkillLayer } from './skills/skills.js';
import { LlmLayer } from './llm/llm.js';
import { McpLayer } from './mcp/mcp.js';
import { CheckpointLayer } from './checkpoint/checkpoint.js';
import { ApprovalLayer } from './approval/approval.js';
import { ApprovalWaitLayer } from './approval/wait.js';
import { TodoLayer } from './todo/todo.js';
import { SessionLayer } from './session/session.js';
import { ToolExecutorLayer } from './tools/tools.js';
import { ContextLayer } from './context/context.js';
import { MemoryLayer } from './memory/memory.js';
import { AgentLayer } from './agent/agent.js';
import { ToolEnvLayer } from './agent/tool-env.js';
import { ToolCatalogLayer } from './agent/tool-catalog.js';
import { SubagentRunnerLayer } from './subagent/subagent.js';
import { SchedulerLayer } from './scheduler/scheduler.js';
import { WorkspaceService } from './workspace/workspace.js';

// base layers
const InfraLayer = Layer.mergeAll(
  WorkspaceService.Default, HookLayer, RulesLayer, SkillLayer, McpLayer, ApprovalWaitLayer, TodoLayer,
);

// catalog 需要 McpService 才能把 MCP 工具喂进来
const ToolCatalogWithDeps = ToolCatalogLayer.pipe(Layer.provide(InfraLayer));

const LlmWithDeps = LlmLayer.pipe(Layer.provide(WorkspaceService.Default));
const ApprovalWithDeps = ApprovalLayer.pipe(Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer)));
const ToolExecutorWithDeps = ToolExecutorLayer.pipe(Layer.provide(Layer.mergeAll(HookLayer, ApprovalWithDeps)));
const ContextWithDeps = ContextLayer.pipe(Layer.provide(Layer.mergeAll(SessionLayer, LlmWithDeps)));
const MemoryWithDeps = MemoryLayer.pipe(Layer.provide(LlmWithDeps));

// agent 直接消费的宽服务集合
const AgentServiceLayers = Layer.mergeAll(
  InfraLayer, SessionLayer, ToolExecutorWithDeps, ApprovalWithDeps,
  ContextWithDeps, MemoryWithDeps, CheckpointLayer, LlmWithDeps,
);

// agent with deps
const AgentWithDeps = AgentLayer.pipe(
  Layer.provide(Layer.mergeAll(AgentServiceLayers, ToolEnvLayer, ToolCatalogWithDeps))
);

// subagent runner (depends on agent)
const SubagentWithDeps = SubagentRunnerLayer.pipe(Layer.provide(AgentWithDeps));

export const AppLayer = Layer.mergeAll(
  InfraLayer,
  LlmWithDeps,
  ApprovalWithDeps,
  SessionLayer,
  ToolExecutorWithDeps,
  ContextWithDeps,
  MemoryWithDeps,
  CheckpointLayer,
  AgentWithDeps,
  SubagentWithDeps,
  SchedulerLayer,
);

export const createAppRuntime = () => ManagedRuntime.make(AppLayer as any);
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
