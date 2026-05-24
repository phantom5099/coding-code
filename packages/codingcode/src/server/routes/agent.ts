import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { McpService } from '../../mcp/index.js';
import { SkillService } from '../../skills/index.js';
import { SubagentRegistry } from '../../subagent/registry.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../memory/index.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

export const agentRouter = new Hono();

agentRouter.get('/memory', (c) => {
  return c.json({ enabled: getMemoryEnabled() });
});

agentRouter.post('/memory', async (c) => {
  const body = await c.req.json() as { enabled: boolean };
  setMemoryEnabled(body.enabled);
  return c.json({ enabled: getMemoryEnabled() });
});

agentRouter.get('/subagent', async (c) => {
  const enabled = await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      return registry.isEnabled();
    }),
  );
  return c.json({ enabled });
});

agentRouter.post('/subagent', async (c) => {
  const body = await c.req.json() as { enabled: boolean };
  await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      registry.setEnabled(body.enabled);
    }),
  );
  return c.json({ ok: true });
});

agentRouter.get('/mcp', async (c) => {
  const status = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.status();
    }),
  );
  return c.json(status);
});

agentRouter.post('/mcp/disable', async (c) => {
  const body = await c.req.json() as { name: string };
  await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.disable(body.name);
    }),
  );
  return c.json({ ok: true });
});

agentRouter.post('/mcp/enable', async (c) => {
  const body = await c.req.json() as { name: string };
  await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.enable(body.name);
    }),
  );
  return c.json({ ok: true });
});

agentRouter.get('/skills', async (c) => {
  const skills = await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.listWithStatus();
    }),
  );
  return c.json(skills);
});

agentRouter.post('/skills', async (c) => {
  const body = await c.req.json() as { name: string; enabled: boolean };
  await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* (body.enabled ? skill.enableSkill(body.name) : skill.disableSkill(body.name));
    }),
  );
  return c.json({ ok: true });
});
