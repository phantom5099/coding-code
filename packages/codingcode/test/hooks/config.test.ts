import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import { loadHookConfigs, writeHookConfigs } from '@codingcode/hook';
import { projectConfigScope } from '@codingcode/util';

const testDir = resolve(tmpdir(), 'codingcode-test-hooks-config');

describe('loadHookConfigs', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty array when no config exists', () => {
    const result = loadHookConfigs(projectConfigScope(join(process.cwd(), 'nonexistent')));
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
    writeHookConfigs(projectConfigScope(testDir), [
      {
        name: 'test-hook',
        point: 'agent.turn.end',
        type: 'observer',
        command: 'echo',
        enabled: true,
      },
    ]);
    const result = loadHookConfigs(projectConfigScope(testDir));
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('test-hook');
    expect(result[0]!.point).toBe('agent.turn.end');
    expect(result[0]!.type).toBe('observer');
  });

  it('should overwrite existing hooks', () => {
    writeHookConfigs(projectConfigScope(testDir), [
      { name: 'old', point: 'agent.turn.start', type: 'observer', command: 'echo', enabled: true },
    ]);
    writeHookConfigs(projectConfigScope(testDir), [
      { name: 'new', point: 'agent.turn.end', type: 'observer', command: 'ls', enabled: false },
    ]);
    const result = loadHookConfigs(projectConfigScope(testDir));
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('new');
    expect(result[0]!.enabled).toBe(false);
  });

  it('should preserve other top-level keys', () => {
    const p = join(testDir, '.codingcode', 'hooks.yaml');
    writeFileSync(p, 'otherKey: value\nhooks: []\n');
    writeHookConfigs(projectConfigScope(testDir), [
      { name: 'srv', point: 'agent.turn.start', type: 'observer', command: 'echo', enabled: true },
    ]);
    const raw = JSON.parse(JSON.stringify(parseYaml(readFileSync(p, 'utf8'))));
    expect(raw.otherKey).toBe('value');
    expect(raw.hooks).toHaveLength(1);
  });
});
