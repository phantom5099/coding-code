import { Effect } from 'effect';
import type { AgentEvent } from '../agent/agent.js';
import type { ContextService } from '../context/context.js';
import type { SessionService, SessionStoreState } from '../session/store.js';
import type { CheckpointService } from '../checkpoint/checkpoint-service.js';
import type { LLMClient } from '../llm/client.js';

export async function* recordTurn(
  source: AsyncGenerator<AgentEvent, any, unknown>,
  deps: { session: SessionService; ctx: ContextService; checkpoint: CheckpointService },
  params: { state: SessionStoreState; sid: string; turnId: number; projectPath: string; llm: LLMClient | null },
): AsyncGenerator<AgentEvent, void, unknown> {
  const { session, ctx, checkpoint } = deps;
  const { state, sid, turnId, projectPath, llm } = params;
  const model = state.sessionMeta?.model ?? 'unknown';

  let assistantUuid: string | undefined;

  try {
    for await (const event of source) {
      yield event;

      if (event._tag === 'Assistant') {
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
  } finally {
    checkpoint.snapshotFinal(projectPath, sid, turnId);
    await Effect.runPromise(ctx.appendTurnEnd(sid, llm));
  }
}
