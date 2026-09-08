import { Effect, Layer } from 'effect';
import { TodoService } from '../todo/port.js';
import { HookService } from '../hooks/port.js';
import { McpService } from '../mcp/port.js';
import { SubagentRunnerService } from '../subagent/port.js';
import { ToolEnvPort } from './deps.js';
import type { ToolEnv } from './deps.js';

/**
 * ToolEnvPort 的实现（组合根一侧）。
 *
 * 它把"工具执行期依赖"（TodoService / HookService / McpService / SubagentRunnerService）
 * 从具体服务适配成 agent 所需的抽象注入能力。agent 只 import ToolEnvPort，不接触这里列出的
 * 任何具体 Tag，从而完成依赖倒置。
 *
 * 关键点：SubagentRunnerService 依赖 AgentService（子代理递归调用主代理），若在 Layer
 * 构造期直接 `yield*` 会形成循环。因此这里构造期不静态依赖任何服务 —— 仅返回
 * `getToolEnv` 函数，`yield* SubagentRunnerService` 延迟到 getToolEnv 在运行时（外层
 * AppRuntime 已就绪）才解析，从而打破递归循环。
 */
export const ToolEnvLayer: Layer.Layer<ToolEnvPort, never, never> = Layer.effect(
  ToolEnvPort,
  Effect.succeed({
    getToolEnv: (): Effect.Effect<ToolEnv, never, any> =>
      Effect.gen(function* () {
        const todoSvc = yield* TodoService;
        const hookSvc = yield* HookService;
        const mcpSvc = yield* McpService;
        const subagentSvc = yield* SubagentRunnerService;
        const env: ToolEnv = {
          provide: (effect: Effect.Effect<any, any, any>) =>
            effect.pipe(
              Effect.provideService(TodoService, todoSvc),
              Effect.provideService(HookService, hookSvc),
              Effect.provideService(McpService, mcpSvc),
              Effect.provideService(SubagentRunnerService, subagentSvc),
            ) as Effect.Effect<any, any, never>,
        };
        return env;
      }),
  })
);
