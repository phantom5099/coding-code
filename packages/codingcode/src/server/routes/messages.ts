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
  const executor = c.get('executor');
  const hooks = c.get('hooks');

  const state = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(process.cwd(), 'unknown', 'coder', '0.1.0', sessionId === '_' ? undefined : sessionId);
    }),
  );

  if (!sessionId) sessionId = state.sessionId;

  return sseHandler(sendMessage(state, input, llm, executor, hooks) as any, {
    initialEvents: [{ type: 'session_id', sessionId }],
  })(c);
});
