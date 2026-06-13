import { Effect, ManagedRuntime } from 'effect';
import { LLMFactoryService } from '../../llm/factory.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export interface ModelClient {
  listModels(): Promise<any>;
  switchModel(input: { id: string }): Promise<void>;
}

export function createDirectModelClient(rt: ManagedRt): ModelClient {
  return {
    async listModels() {
      return rt.runPromise(
        Effect.gen(function* () {
          const factory = yield* LLMFactoryService;
          const modelsResult = yield* Effect.either(factory.listModels());
          if (modelsResult._tag === 'Left') throw modelsResult.left;
          const activeResult = yield* Effect.either(factory.getActiveEntry());
          return {
            models: modelsResult.right,
            activeId: activeResult._tag === 'Right' ? activeResult.right.id : null,
          };
        })
      );
    },

    async switchModel({ id }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const factory = yield* LLMFactoryService;
          const switchResult = yield* Effect.either(factory.switchModel(id));
          if (switchResult._tag === 'Left') throw switchResult.left;
        })
      );
    },
  };
}
