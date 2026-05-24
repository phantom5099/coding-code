import { Hono } from 'hono';
import { sessionsRouter } from './routes/sessions.js';
import { messagesRouter } from './routes/messages.js';
import { modelsRouter } from './routes/models.js';
import { approvalRouter } from './routes/approval.js';
import { agentRouter } from './routes/agent.js';

type ServerDeps = {
  llm: any;
};

declare module 'hono' {
  interface ContextVariableMap {
    llm: any;
  }
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('llm', deps.llm);
    await next();
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/sessions', sessionsRouter);
  app.route('/api', messagesRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api', approvalRouter);
  app.route('/api/agent', agentRouter);

  return app;
}
