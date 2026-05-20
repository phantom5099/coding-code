import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import type { ContextService } from '../context/context.js';
import type { SessionService, SessionStoreState } from '../session/store.js';

export async function* recordAgentEvents(
  source: AsyncGenerator<AgentEvent, any, unknown>,
  ctx: ContextService,
  session: SessionService,
  state: SessionStoreState,
  sid: string,
): AsyncGenerator<AgentEvent, void, unknown> {
  let assistantUuid: string | undefined;
  const model = state.sessionMeta?.model ?? 'unknown';

  for await (const event of source) {
    yield event;

    if (event._tag === 'Assistant') {
      await Effect.runPromise(
        ctx.addAssistant(sid, event.content, event.toolCalls),
      );
      const ev = await Effect.runPromise(
        session.recordAssistant(
          state,
          event.content,
          event.toolCalls as any,
          model,
        ),
      );
      assistantUuid = (ev as any).uuid;
    } else if (event._tag === 'ToolResult') {
      await Effect.runPromise(
        ctx.addToolResult(sid, event.id, event.output, event.name),
      );
      if (assistantUuid) {
        await Effect.runPromise(
          session.recordToolResult(
            state,
            assistantUuid,
            event.name,
            event.id,
            event.output,
          ),
        );
      }
    }
  }
}
