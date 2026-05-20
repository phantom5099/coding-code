import { Hono } from 'hono';
import { Effect } from 'effect';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../orchestrate.js';
import { AppLayer } from '../../layer.js';
import { toSSEString } from '../adapter.js';

export const messagesRouter = new Hono();

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

messagesRouter.post('/sessions/:id/messages', async (c) => {
  let sessionId = c.req.param('id');
  const { input } = await c.req.json();
  const llm = c.get('llm');

  const program = sendMessage(
    sessionId === '_' || !sessionId ? undefined : sessionId,
    input,
    process.cwd(),
    llm,
  );

  const { stream, sessionId: actualSid } = await runWithLayer(program);
  sessionId = actualSid;

  return sseHandler(
    async function* () {
      yield* toSSEString(stream);
    },
    {
      initialEvents: [{ type: 'session_id', sessionId }],
      sessionId,
    },
  )(c);
});
