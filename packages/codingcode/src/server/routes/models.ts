import { Hono } from 'hono';
import { handler } from '../handler.js';
import { Effect } from 'effect';

export const modelsRouter = new Hono();

modelsRouter.get('/', handler(
  Effect.succeed({ models: [], activeId: '' }),
));

modelsRouter.post('/switch', handler(
  Effect.succeed({ ok: true }),
));
