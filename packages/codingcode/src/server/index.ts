import { Hono } from 'hono';
import { sessionsRouter } from './routes/sessions.js';
import { messagesRouter } from './routes/messages.js';
import { modelsRouter } from './routes/models.js';
import { rolesRouter } from './routes/roles.js';

export function createServer(): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/sessions', sessionsRouter);
  app.route('/api', messagesRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api/roles', rolesRouter);

  return app;
}
