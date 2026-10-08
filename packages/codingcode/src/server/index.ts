import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ManagedRuntime } from 'effect';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerMessagesRoutes } from './routes/messages.js';
import { registerModelsRoutes } from './routes/models.js';
import { registerApprovalRoutes } from './routes/approval.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAutomationsRoutes } from './routes/automations.js';
import { registerSubagentsRoutes } from './routes/subagents.js';
import { registerErrorHandler } from './util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export async function createServer(rt: ManagedRt): Promise<Hono> {
  const app = new Hono();

  registerErrorHandler(app);

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  registerSessionsRoutes(app, rt);
  registerMessagesRoutes(app, rt);
  registerModelsRoutes(app, rt);
  registerApprovalRoutes(app, rt);
  registerSettingsRoutes(app, rt);
  registerAutomationsRoutes(app, rt);
  registerSubagentsRoutes(app, rt);

  return app;
}
