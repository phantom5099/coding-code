import { Effect } from 'effect';
import { randomUUID } from 'crypto';

const sessionToAgent = new Map<string, string>();

export class AgentIdResolver extends Effect.Service<AgentIdResolver>()('AgentIdResolver', {
  effect: Effect.gen(function* () {
    return {
      resolve: (sessionId: string): string => {
        let id = sessionToAgent.get(sessionId);
        if (!id) {
          id = randomUUID();
          sessionToAgent.set(sessionId, id);
        }
        return id;
      },
      bind: (sessionId: string, agentId: string): void => {
        sessionToAgent.set(sessionId, agentId);
      },
      reset: (): void => sessionToAgent.clear(),
    };
  }),
}) {}
