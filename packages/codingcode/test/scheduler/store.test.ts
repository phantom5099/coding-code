import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { readAutomations, writeAutomations } from '../../src/scheduler/store.js';
import type { Automation } from '../../src/scheduler/types.js';

const testDir = resolve(process.cwd(), '.test-scheduler-store');
const testFile = join(testDir, 'automations.yaml');

describe('readAutomations', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty array when no file exists', () => {
    const result = readAutomations(join(testDir, 'nonexistent.yaml'));
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid YAML', () => {
    writeFileSync(testFile, 'invalid: yaml: content: [', 'utf8');
    const result = readAutomations(testFile);
    expect(result).toEqual([]);
  });

  it('should read automations from valid YAML', () => {
    const yaml = `automations:
  - id: "test-1"
    name: "Test Automation"
    description: "Test description"
    cron: "0 9 * * *"
    timezone: "Asia/Shanghai"
    sandbox: "workspace-write"
    enabled: true
    projectCwd: "/home/user/project"
    runOnce: false
    createdAt: 1718000000000
    updatedAt: 1718000000000
    lastRunAt: null
    lastSessionId: null
`;
    writeFileSync(testFile, yaml, 'utf8');
    const result = readAutomations(testFile);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-1');
    expect(result[0]!.name).toBe('Test Automation');
    expect(result[0]!.cron).toBe('0 9 * * *');
    expect(result[0]!.enabled).toBe(true);
  });
});

describe('writeAutomations', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should create file and write automations', () => {
    const automations: Automation[] = [
      {
        id: 'test-1',
        name: 'Test',
        description: 'Test description',
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        sandbox: 'workspace-write',
        enabled: true,
        projectCwd: '/home/user/project',
        runOnce: false,
        createdAt: 1718000000000,
        updatedAt: 1718000000000,
        lastRunAt: null,
        lastSessionId: null,
      },
    ];

    writeAutomations(automations, testFile);
    expect(existsSync(testFile)).toBe(true);

    const result = readAutomations(testFile);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-1');
  });

  it('should overwrite existing automations', () => {
    const automations1: Automation[] = [
      {
        id: 'test-1',
        name: 'First',
        description: 'First description',
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        sandbox: 'workspace-write',
        enabled: true,
        projectCwd: '/home/user/project',
        runOnce: false,
        createdAt: 1718000000000,
        updatedAt: 1718000000000,
        lastRunAt: null,
        lastSessionId: null,
      },
    ];

    const automations2: Automation[] = [
      {
        id: 'test-2',
        name: 'Second',
        description: 'Second description',
        cron: '0 10 * * *',
        timezone: 'Asia/Shanghai',
        sandbox: 'readonly',
        enabled: false,
        projectCwd: '/home/user/other',
        runOnce: true,
        createdAt: 1718000000001,
        updatedAt: 1718000000001,
        lastRunAt: 1718000000002,
        lastSessionId: 'session-123',
      },
    ];

    writeAutomations(automations1, testFile);
    writeAutomations(automations2, testFile);

    const result = readAutomations(testFile);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-2');
    expect(result[0]!.name).toBe('Second');
    expect(result[0]!.lastRunAt).toBe(1718000000002);
    expect(result[0]!.lastSessionId).toBe('session-123');
  });

  it('should handle empty array', () => {
    writeAutomations([], testFile);
    const result = readAutomations(testFile);
    expect(result).toEqual([]);
  });

  it('should create directory if not exists', () => {
    const nestedDir = join(testDir, 'nested', 'dir');
    const nestedFile = join(nestedDir, 'automations.yaml');

    writeAutomations([], nestedFile);
    expect(existsSync(nestedFile)).toBe(true);
  });
});
