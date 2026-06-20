import { Context, Layer, Effect, ManagedRuntime } from 'effect';
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
import { WorkspaceService } from './core/workspace.js';
import { TodoService } from './agent/todo.js';
import { ToolSearchService } from './tools/tool-search-service.js';
import { SubagentService } from './subagent/registry.js';
import { SubagentRunnerService } from './subagent/runner-service.js';
import { RulesService } from './rules/index.js';
import { MemoryService } from './memory/index.js';
import { ContextService } from './context/service.js';
import { SchedulerService } from './scheduler/service.js';
import { planApprovalHook } from './hooks/built-in/plan-approval.js';
import { planSubagentWhitelistHook } from './hooks/built-in/plan-subagent-whitelist.js';
import { afterPlanSubmittedObserver } from './hooks/built-in/after-plan-submitted.js';

export const WorkspaceLayer = WorkspaceService.Default;
export const TodoLayer = TodoService.Default;
export const ToolSearchLayer = ToolSearchService.Default;
export const SubagentLayer = SubagentService.Default;
export const RulesLayer = RulesService.Default;
export const SessionLayer = SessionService.Default;
export const LLMFactoryLayer = LLMFactoryService.Default.pipe(Layer.provide(WorkspaceLayer));
export const MemoryLayer = MemoryService.Default.pipe(Layer.provide(LLMFactoryLayer));
export const ContextLayer = ContextService.Default.pipe(
  Layer.provide(Layer.mergeAll(SessionLayer, LLMFactoryLayer))
);
export const HookLayer = HookService.Default;
export const SkillLayer = SkillService.Default;
export const CheckpointLayer = CheckpointService.Default;
export const ApprovalWaitLayer = ApprovalWaitService.Default;
export const McpLayer = McpService.Default;
export const SchedulerLayer = SchedulerService.Default;
export const ProjectRuntimeLayer = ProjectRuntimeService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, McpLayer, SubagentLayer, RulesLayer, SessionLayer))
);
export const ApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookLayer, ApprovalWaitLayer))
);


export const SystemHookLayer = HookLayer.pipe(
  Layer.tap((context) =>
    Effect.gen(function* () {
      const hooks = Context.get(context, HookService);
      // plan/build 1. submit_plan triggers 3-option approval modal
      yield* hooks.registerDecision('tool.approval.pre', planApprovalHook, {
        priority: 1000,
        source: 'system',
      });
      // plan/build 2. plan mode can only dispatch 'explore' subagent
      yield* hooks.registerDecision('agent.subagent.spawn.before', planSubagentWhitelistHook, {
        priority: 900,
        source: 'system',
      });
      // plan/build 3. after submit_plan: switch to build profile
      yield* hooks.register('tool.execute.after', afterPlanSubmittedObserver, {
        source: 'system',
      });
    })
  )
);

/** ToolExecutor depends on HookLayer + ApprovalLayer. */
const ExecutorDeps = Layer.mergeAll(HookLayer, ApprovalLayer);
const ExecutorLayer = ToolExecutorService.Default.pipe(Layer.provide(ExecutorDeps));

/** Agent depends on ToolExecutor + HookLayer + ApprovalLayer + ApprovalWaitLayer + Session + Checkpoint + ProjectRuntime + Skill + LLMFactory + Todo + Rules + Context + Memory. */
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
  ProjectRuntimeLayer,
  TodoLayer,
  RulesLayer,
  ContextLayer,
  MemoryLayer
);
const AgentWithDeps = AgentService.Default.pipe(Layer.provide(AgentDeps));

/** SubagentRunnerService delegates to AgentService.runStream. */
const SubagentRunnerLayer = Layer.effect(
  SubagentRunnerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;
    return SubagentRunnerService.make({ runStream: agent.runStream });
  })
).pipe(Layer.provide(AgentWithDeps));

/** Final application layer — all services merged. */
export const AppLayer = Layer.mergeAll(
  AgentWithDeps,
  SubagentRunnerLayer,
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
  WorkspaceLayer,
  TodoLayer,
  ToolSearchLayer,
  SubagentLayer,
  RulesLayer,
  MemoryLayer,
  ContextLayer,
  SchedulerLayer,
  SystemHookLayer
);

/** Create the application ManagedRuntime from AppLayer. */
// Effect's ManagedRuntime.make typing is overly strict for our AppLayer union;
// runtime has access to all service tags so the cast is safe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createAppRuntime = () => ManagedRuntime.make(AppLayer as any);

/** Concrete runtime type for the application. */
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
