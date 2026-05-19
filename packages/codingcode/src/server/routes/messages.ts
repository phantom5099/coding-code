import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../orchestrate.js';
import { SessionService } from '../../session/store.js';
import { AppLayer } from '../../layer.js';

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

  if (!sessionId) sessionId = state.sessionId;

  // sendMessage and services resolve their own dependencies via AppLayer
  return sseHandler(sendMessage(state, input, llm) as any, {
    initialEvents: [{ type: 'session_id', sessionId }],
  })(c);
});
