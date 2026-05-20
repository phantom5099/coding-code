import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../orchestrate.js';
import { SessionService } from '../../session/store.js';
import { AppLayer } from '../../layer.js';
import { toSSEString } from '../adapter.js';

export const messagesRouter = new Hono();

// Helper to run Effect with AppLayer (AppLayer provides all required services)
function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

messagesRouter.post('/sessions/:id/messages', async (c) => {
  let sessionId = c.req.param('id');
  const { input } = await c.req.json();

  const llm = c.get('llm');

  const state = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(process.cwd(), 'unknown', '0.1.0', sessionId === '_' ? undefined : sessionId);
    }),
  );

  if (sessionId === '_' || !sessionId) sessionId = state.sessionId;

  const program = sendMessage(state, input, llm);

  return sseHandler(
    async function* () {
      const agentGen = await Effect.runPromise(
        program.pipe(Effect.provide(AppLayer) as any),
      ) as AsyncGenerator<any, void, unknown>;
      yield* toSSEString(agentGen);
    },
    {
      initialEvents: [{ type: 'session_id', sessionId }],
      sessionId,
    },
  )(c);
});
