/**
 * @vitest-environment node
 *
 * 请求体边界：body 是未验证输入 —— 必填项缺失必须在落盘前就被拦成 400。
 * 这几条路由此前没有任何测试，而它们会把 body 直接写进 hooks.yaml / mcp.yaml。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Layer, ManagedRuntime } from 'effect';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { createServer, type ServerApp } from '../../src/server/index.js';
import { useTempHome } from '../helpers/temp-home.js';

// 全局层落在临时 home，避免写坏开发机的 ~/.codingcode
useTempHome('codingcode-test-body-');

let projectDir: string;
// 校验失败在任何 Effect 之前就返回，故运行时可以是空壳 —— 只有走到「校验通过」的
// 分支才会去 context 里取 SchedulerService。
let app: ServerApp;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), 'codingcode-test-body-project-'));
  app = await createServer(ManagedRuntime.make(Layer.empty as any));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function send(target: ServerApp, method: string, path: string, body: unknown) {
  return target.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const yamlOf = (file: string): any =>
  parseYaml(readFileSync(join(projectDir, '.codingcode', file), 'utf8'));

const HOOK = {
  name: 'h',
  point: 'tool.execute.before',
  type: 'observer',
  command: 'echo hi',
};

describe('POST /api/settings/hooks —— 必填项', () => {
  it('空 body 落 400 CONFIG_MISSING，且不写任何文件', async () => {
    const res = await send(app, 'POST', `/api/settings/hooks?cwd=${projectDir}`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CONFIG_MISSING');
    expect(existsSync(join(projectDir, '.codingcode', 'hooks.yaml'))).toBe(false);
  });

  it('只缺 point 同样拒绝（body 断言不再把半截对象当完整 hook）', async () => {
    const { point: _point, ...withoutPoint } = HOOK;
    const res = await send(
      app,
      'POST',
      `/api/settings/hooks?cwd=${projectDir}`,
      withoutPoint
    );
    expect(res.status).toBe(400);
    expect(existsSync(join(projectDir, '.codingcode', 'hooks.yaml'))).toBe(false);
  });

  it('四个必填项齐全时写入 yaml', async () => {
    const res = await send(app, 'POST', `/api/settings/hooks?cwd=${projectDir}`, HOOK);
    expect(res.status).toBe(200);
    const hooks = yamlOf('hooks.yaml').hooks;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject(HOOK);
  });
});

describe('PUT /api/settings/hooks/:name —— 必填项', () => {
  it('空 body 落 400，不进入查找流程', async () => {
    const res = await send(
      app,
      'PUT',
      `/api/settings/hooks/h?cwd=${projectDir}`,
      { name: 'h' }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CONFIG_MISSING');
  });
});

describe('POST /api/settings/mcp —— name 必填', () => {
  it('空 body 落 400 CONFIG_MISSING', async () => {
    const res = await send(app, 'POST', `/api/settings/mcp?cwd=${projectDir}`, {
      command: 'npx',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CONFIG_MISSING');
    expect(existsSync(join(projectDir, '.codingcode', 'mcp.yaml'))).toBe(false);
  });

  it('只有 name 也能成立（stdio/http 的其余字段本就可选）', async () => {
    const res = await send(app, 'POST', `/api/settings/mcp?cwd=${projectDir}`, {
      name: 'srv',
      url: 'https://example.com/mcp',
    });
    expect(res.status).toBe(200);
    expect(yamlOf('mcp.yaml').servers).toMatchObject([{ name: 'srv' }]);
  });
});

describe('POST /api/automations —— 四个必填项', () => {
  it('空 body 落 400 CONFIG_MISSING', async () => {
    const res = await send(app, 'POST', '/api/automations', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CONFIG_MISSING');
  });

  it('只缺 projectCwd 也拒绝', async () => {
    const res = await send(app, 'POST', '/api/automations', {
      name: 'a',
      description: 'd',
      cron: '0 9 * * *',
    });
    expect(res.status).toBe(400);
  });
});
