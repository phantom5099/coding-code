import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sessionsRouter } from './routes/sessions.js';
import { messagesRouter } from './routes/messages.js';
import { modelsRouter } from './routes/models.js';
import { approvalRouter } from './routes/approval.js';
import { agentRouter } from './routes/agent.js';
import { settingsRouter } from './routes/settings.js';
import { automationsRouter } from './routes/automations.js';
import { AgentError, AlreadyExistsError, NotFoundError } from '../core/error.js';

export async function createServer(): Promise<Hono> {
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

  app.route('/api/sessions', sessionsRouter);
  app.route('/api', messagesRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api', approvalRouter);
  app.route('/api/agent', agentRouter);
  app.route('/api/settings', settingsRouter);
  app.route('/api/automations', automationsRouter);

  return app;
}
