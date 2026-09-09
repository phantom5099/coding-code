import { Layer, Effect, ManagedRuntime } from 'effect';
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
import { WorkspaceService } from './core/workspace.js';

import { HookService } from './hooks/port.js';
import { RulesService } from './rules/port.js';
import { SkillService } from './skills/port.js';
import { LLMFactoryService } from './llm/port.js';
import { McpService } from './mcp/port.js';
import { CheckpointService } from './checkpoint/port.js';
import { ApprovalService } from './approval/port.js';
import { ApprovalWaitService } from './approval/wait-port.js';
import { TodoService } from './todo/port.js';
import { SessionService } from './session/port.js';
import { ToolExecutorService } from './tools/port.js';
import { ContextService } from './context/port.js';
import { MemoryService } from './memory/port.js';

import {
  SessionPort, ToolExecutorPort, CheckpointPort, HookPort,
  ApprovalPort, SkillPort, McpPort, ContextPort, MemoryPort,
  LlmPort, RulesPort, TodoPort,
} from './agent/deps.js';

// adapter layers: map full services to agent's narrow ports
const AgentSessionAdapter = Layer.effect(SessionPort, Effect.gen(function* () {
  const s = yield* SessionService;
  return {
    load: s.load.bind(s), create: s.create.bind(s),
    recordUser: s.recordUser.bind(s), recordSystem: s.recordSystem.bind(s), recordAssistant: s.recordAssistant.bind(s),
    recordToolResult: s.recordToolResult.bind(s),
    setPermissionMode: s.setPermissionMode.bind(s),
    setActiveProfile: s.setActiveProfile.bind(s),
  };
}));

const AgentToolExecutorAdapter = Layer.effect(ToolExecutorPort, Effect.gen(function* () {
  const e = yield* ToolExecutorService;
  return { executeBatch: e.executeBatch.bind(e) };
}));

const AgentCheckpointAdapter = Layer.effect(CheckpointPort, Effect.gen(function* () {
  const c = yield* CheckpointService;
  return { snapshotBaseline: c.snapshotBaseline.bind(c), snapshotFinal: c.snapshotFinal.bind(c) };
}));

const AgentHookAdapter = Layer.effect(HookPort, Effect.gen(function* () {
  const h = yield* HookService;
  return { emit: h.emit.bind(h), emitDecision: h.emitDecision.bind(h), disposeSession: h.disposeSession.bind(h) };
}));

const AgentApprovalAdapter = Layer.effect(ApprovalPort, Effect.gen(function* () {
  const a = yield* ApprovalService;
  return { evaluate: a.evaluate.bind(a) };
}));

const AgentSkillAdapter = Layer.effect(SkillPort, Effect.gen(function* () {
  const s = yield* SkillService;
  return { extractSkill: s.extractSkill.bind(s) };
}));

const AgentMcpAdapter = Layer.effect(McpPort, Effect.gen(function* () {
  const m = yield* McpService;
  return { listProjectMcpTools: m.listProjectMcpTools.bind(m), syncConnections: m.syncConnections.bind(m) };
}));

const AgentContextAdapter = Layer.effect(ContextPort, Effect.gen(function* () {
  const c = yield* ContextService;
  return {
    assemblePayload: c.assemblePayload.bind(c),
  };
}));

const AgentMemoryAdapter = Layer.effect(MemoryPort, Effect.gen(function* () {
  const m = yield* MemoryService;
  return { loadMemoryForPrompt: m.loadMemoryForPrompt.bind(m), flushSessionToMemory: m.flushSessionToMemory.bind(m) };
}));

const AgentLlmAdapter = Layer.effect(LlmPort, Effect.gen(function* () {
  const f = yield* LLMFactoryService;
  return { getLLMClient: f.getLLMClient.bind(f) };
}));

const AgentRulesAdapter = Layer.effect(RulesPort, Effect.gen(function* () {
  const r = yield* RulesService;
  return { getAllRules: r.getAllRules.bind(r), evictProjectRules: r.evictProjectRules.bind(r) };
}));

const AgentTodoAdapter = Layer.effect(TodoPort, Effect.gen(function* () {
  const t = yield* TodoService;
  return { read: t.read.bind(t) };
}));

const AgentDepsAdapter = Layer.mergeAll(
  AgentSessionAdapter, AgentToolExecutorAdapter, AgentCheckpointAdapter,
  AgentHookAdapter, AgentApprovalAdapter, AgentSkillAdapter, AgentMcpAdapter,
  AgentContextAdapter, AgentMemoryAdapter, AgentLlmAdapter, AgentRulesAdapter,
  AgentTodoAdapter,
);

// base layers
const InfraLayer = Layer.mergeAll(
  WorkspaceService.Default, HookLayer, RulesLayer, SkillLayer, McpLayer, ApprovalWaitLayer, TodoLayer,
);

const LlmWithDeps = LlmLayer.pipe(Layer.provide(WorkspaceService.Default));
const ApprovalWithDeps = ApprovalLayer.pipe(Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer)));
const ToolExecutorWithDeps = ToolExecutorLayer.pipe(Layer.provide(Layer.mergeAll(HookLayer, ApprovalWithDeps)));
const ContextWithDeps = ContextLayer.pipe(Layer.provide(Layer.mergeAll(SessionLayer, LlmWithDeps)));
const MemoryWithDeps = MemoryLayer.pipe(Layer.provide(LlmWithDeps));

// agent deps adapters wrap concrete services, so provide them first
const AgentDepsWithDeps = AgentDepsAdapter.pipe(
  Layer.provide(Layer.mergeAll(
    InfraLayer, SessionLayer, ToolExecutorWithDeps, ApprovalWithDeps,
    ContextWithDeps, MemoryWithDeps, CheckpointLayer, LlmWithDeps,
  ))
);

// agent with deps
const AgentWithDeps = AgentLayer.pipe(
  Layer.provide(Layer.mergeAll(AgentDepsWithDeps, ToolEnvLayer, ToolCatalogLayer))
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
