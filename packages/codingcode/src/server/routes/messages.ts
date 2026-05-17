import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../orchestrate.js';
import { SessionService } from '../../session/store.js';
import { AppLayer } from '../../layer.js';

export const messagesRouter = new Hono();

messagesRouter.post('/sessions/:id/messages', async (c) => {
  const sessionId = c.req.param('id');
  const { input } = await c.req.json();

  const llm = c.get('llm');
  const executor = c.get('executor');
  const hooks = c.get('hooks');

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(process.cwd(), 'unknown', 'coder', '0.1.0', sessionId);
    }).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );

  return sseHandler(sendMessage(state, input, llm, executor, hooks))(c);
});
