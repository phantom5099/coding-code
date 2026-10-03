import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import {
  mergeNamed,
  patchNamed,
  readNamedList,
  writeNamedList,
  yamlStorePath,
  type NamedListFile,
} from '../../src/infra/yaml-store.js';

interface Item {
  name: string;
  enabled?: boolean;
  command?: string;
}

const FILE: NamedListFile = { fileName: 'widgets', key: 'widgets' };

let dir: string;

function storePath(ext = 'yaml'): string {
  return join(dir, `widgets.${ext}`);
}

function readRawYaml(): Record<string, unknown> {
  return parseYaml(readFileSync(storePath(), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codingcode-test-yaml-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('yamlStorePath', () => {
  it('.yaml 优先，缺失时才退回 .yml', () => {
    expect(yamlStorePath(dir, FILE)).toBe(storePath('yaml'));

    writeFileSync(storePath('yml'), 'widgets: []\n');
    expect(yamlStorePath(dir, FILE)).toBe(storePath('yml'));

    writeFileSync(storePath('yaml'), 'widgets: []\n');
    expect(yamlStorePath(dir, FILE)).toBe(storePath('yaml'));
  });
});

describe('readNamedList', () => {
  it('文件不存在 → []', () => {
    expect(readNamedList<Item>(dir, FILE)).toEqual([]);
  });

  it('YAML 非法 → []（不让坏文件炸掉整条链路）', () => {
    writeFileSync(storePath(), 'widgets: [1, 2\n');
    expect(readNamedList<Item>(dir, FILE)).toEqual([]);
  });

  it('顶层键缺失 → []', () => {
    writeFileSync(storePath(), 'otherKey: 1\n');
    expect(readNamedList<Item>(dir, FILE)).toEqual([]);
  });

  it('从 .yml 也能读', () => {
    writeFileSync(storePath('yml'), 'widgets:\n  - name: from-yml\n');
    expect(readNamedList<Item>(dir, FILE)).toEqual([{ name: 'from-yml' }]);
  });
});

describe('writeNamedList', () => {
  it('目录不存在则自建', () => {
    const nested = join(dir, 'a', 'b');
    writeNamedList(nested, FILE, [{ name: 'x' }]);
    expect((parseYaml(readFileSync(join(nested, 'widgets.yaml'), 'utf8')) as any).widgets).toEqual([
      { name: 'x' },
    ]);
  });

  it('覆盖同名列表，但保留文件里其它顶层键', () => {
    writeFileSync(storePath(), 'otherKey: keep-me\nwidgets: []\n');
    writeNamedList(dir, FILE, [{ name: 'new' }]);
    const raw = readRawYaml();
    expect(raw.otherKey).toBe('keep-me');
    expect(raw.widgets).toEqual([{ name: 'new' }]);
  });
});

describe('mergeNamed', () => {
  it('按 name 做字段级合并：未写出的字段继承前一层', () => {
    const base: Item[] = [{ name: 'a', enabled: true, command: 'x' }];
    const override: Item[] = [{ name: 'a', command: 'y' }];
    expect(mergeNamed(base, override)).toEqual([{ name: 'a', enabled: true, command: 'y' }]);
  });

  it('显式 undefined 不擦掉前一层已有的值', () => {
    const base: Item[] = [{ name: 'a', enabled: true, command: 'x' }];
    const override = [{ name: 'a', enabled: undefined, command: undefined }] as Item[];
    expect(mergeNamed(base, override)).toEqual([{ name: 'a', enabled: true, command: 'x' }]);
  });

  it('新 name 追加在后，且不动原数组', () => {
    const base: Item[] = [{ name: 'a', enabled: true }];
    const override: Item[] = [{ name: 'b' }];
    expect(mergeNamed(base, override)).toEqual([{ name: 'a', enabled: true }, { name: 'b' }]);
    expect(base).toEqual([{ name: 'a', enabled: true }]);
  });
});

describe('patchNamed', () => {
  it('name 不存在 → 追加 { name, ...patch }，并建出目录/文件', () => {
    const nested = join(dir, 'created');
    patchNamed<Item>(nested, FILE, 'fresh', { enabled: false });
    expect(readNamedList<Item>(nested, FILE)).toEqual([{ name: 'fresh', enabled: false }]);
  });

  it('name 存在 → 只改 patch 里的字段，其它字段原样保留', () => {
    writeNamedList(dir, FILE, [{ name: 'a', enabled: true, command: 'x' }]);
    patchNamed<Item>(dir, FILE, 'a', { enabled: false });
    expect(readNamedList<Item>(dir, FILE)).toEqual([{ name: 'a', enabled: false, command: 'x' }]);
  });

  it('打 patch 不动同文件里的其它顶层键', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath(), 'otherKey: keep-me\nwidgets:\n  - name: a\n    enabled: true\n');
    patchNamed<Item>(dir, FILE, 'a', { enabled: false });
    expect(readRawYaml().otherKey).toBe('keep-me');
  });
});
