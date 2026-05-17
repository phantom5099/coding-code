import { Hono } from 'hono';
import { sseHandler } from '../handler.js';
import { sendMessage } from '../../orchestrate.js';

export const messagesRouter = new Hono();

// SSE 流式消息
messagesRouter.post('/sessions/:id/messages', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  return sseHandler(sendMessage(body.state, body.input, body.llm, body.executor, body.hooks))(c);
});
