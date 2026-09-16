import { Effect, Layer } from 'effect';
import { TodoService } from '../todo/port.js';
import { HookService } from '../hooks/port.js';
import { McpService } from '../mcp/port.js';
import { SubagentRunnerService } from '../subagent/port.js';
import { ToolEnvPort } from './port.js';
import type { ToolEnv } from './port.js';

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
