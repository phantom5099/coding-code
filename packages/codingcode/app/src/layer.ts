import { Layer, ManagedRuntime } from 'effect';
import { HookLayer } from '@codingcode/hook';
import { RulesLayer } from '@codingcode/rules';
import { SkillLayer } from '@codingcode/skill';
import { LlmLayer } from '@codingcode/model';
import { McpLayer } from '@codingcode/mcp';
import { CheckpointLayer } from '@codingcode/checkpoint';
import { ApprovalLayer, ApprovalWaitLayer } from '@codingcode/approval';
import { EventSinkLayer } from '@codingcode/sink';
import { TodoLayer } from '@codingcode/todo';
import { AskWaitLayer } from '@codingcode/askuser';
import { SessionLayer } from '@codingcode/session';
import { ToolExecutorLayer, makeToolRegistryLayer } from '@codingcode/tool';
import { FS_TOOLS } from '@codingcode/fs';
import { BASH_TOOLS } from '@codingcode/bash';
import { WEB_TOOLS } from '@codingcode/web';
import { SELF_TOOLS } from '@codingcode/self';
import { ContextLayer } from '@codingcode/context';
import { MemoryLayer } from '@codingcode/memory';
import { AgentLayer, ToolEnvLayer } from '@codingcode/agent';
import { SUBAGENT_TOOLS, SubagentRunnerLayer, SubagentRunRegistryLayer } from '@codingcode/subagent';
import { TurnRegistryLayer } from '@codingcode/turn';
import { MailboxLayer } from '@codingcode/mailbox';
import { SchedulerLayer } from '@codingcode/scheduler';

// base layers
const InfraLayer = Layer.mergeAll(
  HookLayer,
  RulesLayer,
  SkillLayer,
  McpLayer,
  EventSinkLayer,
  MailboxLayer,
  ApprovalWaitLayer,
  AskWaitLayer,
  TodoLayer
);

// 状态帧由 turn 投递 ⇒ turn 要 sink；
const TurnWithDeps = TurnRegistryLayer.pipe(Layer.provide(EventSinkLayer));

const ApprovalWithDeps = ApprovalLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, EventSinkLayer, ApprovalWaitLayer))
);

// 叶子工具包在组合根统一注册进 ToolRegistry，彻底消除 tool ↔ subagent 循环依赖
const ToolRegistryWithTools = makeToolRegistryLayer([
  ...FS_TOOLS,
  ...BASH_TOOLS,
  ...WEB_TOOLS,
  ...SELF_TOOLS,
  ...SUBAGENT_TOOLS,
]);
const ToolExecutorWithDeps = ToolExecutorLayer.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ToolRegistryWithTools))
);
const ContextWithDeps = ContextLayer.pipe(
  Layer.provide(Layer.mergeAll(SessionLayer, LlmLayer, EventSinkLayer, TurnWithDeps))
);
const MemoryWithDeps = MemoryLayer.pipe(Layer.provide(LlmLayer));

// agent 直接消费的宽服务集合
const AgentServiceLayers = Layer.mergeAll(
  InfraLayer,
  SessionLayer,
  ToolExecutorWithDeps,
  ApprovalWithDeps,
  ContextWithDeps,
  MemoryWithDeps,
  CheckpointLayer,
  LlmLayer,
  TurnWithDeps
);

// agent with deps
const AgentWithDeps = AgentLayer.pipe(
  Layer.provide(Layer.mergeAll(AgentServiceLayers, ToolEnvLayer))
);

// subagent runner (depends on agent)
const SubagentWithDeps = SubagentRunnerLayer.pipe(Layer.provide(AgentWithDeps));

// 运行注册表：要 runner 起子代理、要 session 把终态写进父转录、要 mailbox 投递终态、
// 要 sink 发 subagent_event 帧、要 hooks 在子代理终态时触发 agent.subagent.complete。
// 终态归属已并入状态表（turn 已在 AgentWithDeps 链路里，Layer 按引用去重 ⇒ 全进程一份 records）。
const SubagentRunRegistryWithDeps = SubagentRunRegistryLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      SubagentWithDeps,
      SessionLayer,
      MailboxLayer,
      EventSinkLayer,
      HookLayer,
      TurnWithDeps
    )
  )
);

export const AppLayer = Layer.mergeAll(
  InfraLayer,
  LlmLayer,
  ApprovalWithDeps,
  SessionLayer,
  ToolRegistryWithTools,
  ToolExecutorWithDeps,
  ContextWithDeps,
  MemoryWithDeps,
  CheckpointLayer,
  AgentWithDeps,
  SubagentWithDeps,
  SubagentRunRegistryWithDeps,
  TurnWithDeps,
  SchedulerLayer,
  EventSinkLayer
);

export const createAppRuntime = () => ManagedRuntime.make(AppLayer);
export type AppRuntime = ReturnType<typeof createAppRuntime>;
