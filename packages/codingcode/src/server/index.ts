import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ManagedRuntime } from 'effect';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerMessagesRoutes } from './routes/messages.js';
import { registerModelsRoutes } from './routes/models.js';
import { registerApprovalRoutes } from './routes/approval.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAutomationsRoutes } from './routes/automations.js';
import { AgentError } from '../core/error.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export async function createServer(rt: ManagedRt): Promise<Hono> {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AgentError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.httpStatus() as any);
    }
    if (
      err &&
      typeof (err as { code?: unknown }).code === 'string' &&
      typeof (err as { httpStatus?: unknown }).httpStatus === 'function'
    ) {
      const e = err as unknown as { code: string; message: string; httpStatus: () => number };
      return c.json({ error: { code: e.code, message: e.message } }, e.httpStatus() as any);
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

  registerSessionsRoutes(app, rt);
  registerMessagesRoutes(app, rt);
  registerModelsRoutes(app, rt);
  registerApprovalRoutes(app, rt);
  await registerSettingsRoutes(app, rt);
  registerAutomationsRoutes(app, rt);

  return app;
}
