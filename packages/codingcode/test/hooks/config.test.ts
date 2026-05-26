import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { loadHookConfigs, writeHookConfigs } from '../../src/hooks/config.js';

const testDir = resolve(process.cwd(), '.test-hooks-config');

describe('loadHookConfigs', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty array when no config exists', () => {
    const result = loadHookConfigs(join(process.cwd(), 'nonexistent'));
    expect(result).toEqual([]);
  });
});

describe('writeHookConfigs', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should write and read back hooks', () => {
    writeHookConfigs(testDir, [{
      name: 'test-hook',
      point: 'session.save.before',
      type: 'observer',
      command: 'echo',
      enabled: true,
    }]);
    const result = loadHookConfigs(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-hook');
    expect(result[0].point).toBe('session.save.before');
    expect(result[0].type).toBe('observer');
  });

  it('should overwrite existing hooks', () => {
    writeHookConfigs(testDir, [{ name: 'old', point: 'agent.turn.start', type: 'observer', command: 'echo', enabled: true }]);
    writeHookConfigs(testDir, [{ name: 'new', point: 'agent.turn.end', type: 'observer', command: 'ls', enabled: false }]);
    const result = loadHookConfigs(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('new');
    expect(result[0].enabled).toBe(false);
  });

  it('should preserve other top-level keys', () => {
    const p = join(testDir, '.codingcode', 'hooks.yaml');
    writeFileSync(p, 'otherKey: value\nhooks: []\n');
    writeHookConfigs(testDir, [{ name: 'srv', point: 'agent.turn.start', type: 'observer', command: 'echo', enabled: true }]);
    const raw = JSON.parse(JSON.stringify(parseYaml(readFileSync(p, 'utf8'))));
    expect(raw.otherKey).toBe('value');
    expect(raw.hooks).toHaveLength(1);
  });
});
