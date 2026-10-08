import { describe, expect, it } from 'vitest';
import { Chunk } from 'effect';
import { buildRouter } from '../../src/server/app.js';

/**
 * 路由表结构。这些约束以前靠「mock 掉各 register* 函数、数 Hono 实例」来间接保证，
 * 现在路由表本身是个值，可以直接断言。
 */
const routes = Chunk.toReadonlyArray(buildRouter().routes);
const keys = routes.map((route) => `${route.method} ${route.path}`);

describe('服务器路由表', () => {
  it('同一个 METHOD + path 只注册一次', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('七组路由都挂在同一张表上', () => {
    const registered = new Set(keys);
    for (const expected of [
      'GET /api/health',
      'GET /api/sessions',
      'POST /api/sessions/:id/messages',
      'GET /api/models',
      'POST /api/sessions/:sessionId/approval/:id',
      'GET /api/settings/agent/config',
      'GET /api/automations',
      'POST /api/sessions/:id/subagents/stop',
    ]) {
      expect(registered.has(expected), `缺少路由 ${expected}`).toBe(true);
    }
  });

  // 兜底通配会把「没这条路由」变成「有路由但返回别的东西」，404 就再也发不出来
  it('没有兜底通配路由', () => {
    expect(routes.some((route) => route.path === '*')).toBe(false);
  });
});
