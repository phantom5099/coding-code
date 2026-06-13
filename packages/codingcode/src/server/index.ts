import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ManagedRuntime } from 'effect';
import { createSessionsRouter } from './routes/sessions.js';
import { createMessagesRouter } from './routes/messages.js';
import { createModelsRouter } from './routes/models.js';
import { createApprovalRouter } from './routes/approval.js';
import { createAgentRouter } from './routes/agent.js';
import { createSettingsRouter } from './routes/settings.js';
import { createAutomationsRouter } from './routes/automations.js';
import { AgentError, AlreadyExistsError, NotFoundError } from '../core/error.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export async function createServer(rt: ManagedRt): Promise<Hono> {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AgentError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.httpStatus() as any);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    if (err instanceof AlreadyExistsError) {
      return c.json({ error: { code: 'ALREADY_EXISTS', message: err.message } }, 409);
    }
    console.error('[500 INTERNAL_ERROR]', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  });

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/sessions', createSessionsRouter(rt));
  app.route('/api', createMessagesRouter(rt));
  app.route('/api/models', createModelsRouter(rt));
  app.route('/api', createApprovalRouter(rt));
  app.route('/api/agent', createAgentRouter(rt));
  app.route('/api/settings', await createSettingsRouter(rt));
  app.route('/api/automations', createAutomationsRouter(rt));

  return app;
}
