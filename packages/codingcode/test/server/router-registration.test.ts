import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  honoInstances: 0,
  registrations: [] as Array<{ name: string; router: unknown; runtime: unknown }>,
}));

vi.mock('hono', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hono')>();
  return {
    ...actual,
    Hono: class extends actual.Hono {
      constructor(...args: ConstructorParameters<typeof actual.Hono>) {
        super(...args);
        state.honoInstances += 1;
      }
    },
  };
});

function register(name: string) {
  return (router: unknown, runtime: unknown) => {
    state.registrations.push({ name, router, runtime });
  };
}

vi.mock('../../src/server/routes/sessions.js', () => ({
  registerSessionsRoutes: register('sessions'),
}));
vi.mock('../../src/server/routes/messages.js', () => ({
  registerMessagesRoutes: register('messages'),
}));
vi.mock('../../src/server/routes/models.js', () => ({
  registerModelsRoutes: register('models'),
}));
vi.mock('../../src/server/routes/approval.js', () => ({
  registerApprovalRoutes: register('approval'),
}));
vi.mock('../../src/server/routes/settings.js', () => ({
  registerSettingsRoutes: register('settings'),
}));
vi.mock('../../src/server/routes/automations.js', () => ({
  registerAutomationsRoutes: register('automations'),
}));

import { createServer } from '../../src/server/index.js';

describe('server route registration', () => {
  beforeEach(() => {
    state.honoInstances = 0;
    state.registrations.length = 0;
  });

  it('registers every route group on the single server router', async () => {
    const runtime = {} as never;
    const app = await createServer(runtime);

    expect(state.honoInstances).toBe(1);
    expect(state.registrations.map(({ name }) => name)).toEqual([
      'sessions',
      'messages',
      'models',
      'approval',
      'settings',
      'automations',
    ]);
    expect(state.registrations.every(({ router }) => router === app)).toBe(true);
    expect(state.registrations.every(({ runtime: value }) => value === runtime)).toBe(true);
  });
});
