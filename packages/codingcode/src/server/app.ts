import * as HttpMiddleware from '@effect/platform/HttpMiddleware';
import * as HttpRouter from '@effect/platform/HttpRouter';
import { Cause, Effect } from 'effect';
import { toHttpServerResponse } from './http-error.js';
import { json, type Handler } from './handler.js';
import { addSessionsRoutes } from './routes/sessions.js';
import { addMessagesRoutes } from './routes/messages.js';
import { addModelsRoutes } from './routes/models.js';
import { addApprovalRoutes } from './routes/approval.js';
import { addSettingsRoutes } from './routes/settings.js';
import { addAutomationsRoutes } from './routes/automations.js';
import { addSubagentsRoutes } from './routes/subagents.js';

export const corsMiddleware = HttpMiddleware.cors({
  allowedOrigins: ['*'],
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

const health: Handler = Effect.sync(() => json({ status: 'ok' }));

export const buildRouter = (): HttpRouter.HttpRouter<any, any> =>
  HttpRouter.empty.pipe(
    HttpRouter.get('/api/health', health),
    addSessionsRoutes,
    addMessagesRoutes,
    addModelsRoutes,
    addApprovalRoutes,
    addSettingsRoutes,
    addAutomationsRoutes,
    addSubagentsRoutes
  );


export const createHttpApp = () =>
  HttpRouter.toHttpApp(buildRouter()).pipe(
    Effect.map((app) =>
      app.pipe(
        Effect.catchAllCause((cause) => {
          const err = Cause.squash(cause);
          const response = toHttpServerResponse(err);
          if (response.status >= 500) console.error(`[${response.status}]`, err);
          return Effect.succeed(response);
        })
      )
    )
  );
