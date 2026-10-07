import { Layer, ManagedRuntime } from 'effect';
import { HookLayer } from './hooks/hooks.js';
import { RulesLayer } from './rules/rules.js';
import { SkillLayer } from './skills/skills.js';
import { LlmLayer } from './llm/llm.js';
import { McpLayer } from './mcp/mcp.js';
import { CheckpointLayer } from './checkpoint/checkpoint.js';
import { ApprovalLayer } from './approval/approval.js';
import { ApprovalWaitLayer } from './approval/wait.js';
import { EventSinkLayer } from './sink/sink.js';
import { TodoLayer } from './todo/todo.js';
import { SessionLayer } from './session/session.js';
import { ToolExecutorLayer } from './tools/tools.js';
import { ContextLayer } from './context/context.js';
import { MemoryLayer } from './memory/memory.js';
import { AgentLayer } from './agent/agent.js';
import { ToolEnvLayer } from './agent/tool-env.js';
import { SubagentRunnerLayer } from './subagent/subagent.js';
import { SubagentRunRegistryLayer } from './subagent/registry.js';
import { MailboxLayer } from './session/mailbox.js';
import { SchedulerLayer } from './scheduler/scheduler.js';

// base layers
const InfraLayer = Layer.mergeAll(
  HookLayer,
  RulesLayer,
  SkillLayer,
  McpLayer,
  EventSinkLayer,
  ApprovalWaitLayer,
  TodoLayer
);

const ApprovalWithDeps = ApprovalLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, EventSinkLayer, ApprovalWaitLayer))
);
const ToolExecutorWithDeps = ToolExecutorLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWithDeps))
);
const ContextWithDeps = ContextLayer.pipe(
  Layer.provide(Layer.mergeAll(SessionLayer, LlmLayer, EventSinkLayer))
);
const MemoryWithDeps = MemoryLayer.pipe(Layer.provide(LlmLayer));

// agent 直接消费的宽服务集合
const AgentServiceLayers = Layer.mergeAll(
  InfraLayer,
  SessionLayer,
  MailboxLayer,
  ToolExecutorWithDeps,
  ApprovalWithDeps,
  ContextWithDeps,
  MemoryWithDeps,
  CheckpointLayer,
  LlmLayer
);

// agent with deps
const AgentWithDeps = AgentLayer.pipe(
  Layer.provide(Layer.mergeAll(AgentServiceLayers, ToolEnvLayer))
);

// subagent runner (depends on agent)
const SubagentWithDeps = SubagentRunnerLayer.pipe(Layer.provide(AgentWithDeps));

// 运行注册表：要 runner 起子代理、要 mailbox 投递终态、要 sink 发 subagent_event 帧、
// 要 hooks 在子代理终态时触发 agent.subagent.complete。
// 不依赖 SessionLayer —— 它不写盘，写盘由父回合循环在 drain 点做。
const SubagentRunRegistryWithDeps = SubagentRunRegistryLayer.pipe(
  Layer.provide(Layer.mergeAll(SubagentWithDeps, MailboxLayer, EventSinkLayer, HookLayer))
);

export const AppLayer = Layer.mergeAll(
  InfraLayer,
  LlmLayer,
  ApprovalWithDeps,
  SessionLayer,
  MailboxLayer,
  ToolExecutorWithDeps,
  ContextWithDeps,
  MemoryWithDeps,
  CheckpointLayer,
  AgentWithDeps,
  SubagentWithDeps,
  SubagentRunRegistryWithDeps,
  SchedulerLayer,
  EventSinkLayer
);

export const createAppRuntime = () => ManagedRuntime.make(AppLayer);
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
