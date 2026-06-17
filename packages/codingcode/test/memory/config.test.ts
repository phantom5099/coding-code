import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEffectiveTypes,
  getAllTypesWithStatus,
  setMemoryTypeDisabled,
  addMemoryExtraType,
  updateMemoryExtraType,
  deleteMemoryExtraType,
} from '../../src/memory/config.js';
import type { MemoryConfig, MemoryTypeConfig } from '@codingcode/infra/config';

// mock the infra persistence functions (hoisted to top so vi.mock factory can access them)
const { mockUpdateDisabledTypes, mockUpdateExtraTypes } = vi.hoisted(() => ({
  mockUpdateDisabledTypes: vi.fn(),
  mockUpdateExtraTypes: vi.fn(),
}));
vi.mock('@codingcode/infra/config', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    updateMemoryDisabledTypes: mockUpdateDisabledTypes,
    updateMemoryExtraTypes: mockUpdateExtraTypes,
  };
});

function makeCfg(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return {
    enabled: true,
    model: '',
    extraTypes: [],
    disabledTypes: [],
    promptMaxBytes: 8192,
    ...overrides,
  };
}

describe('Memory Config', () => {
  beforeEach(() => {
    mockUpdateDisabledTypes.mockClear();
    mockUpdateExtraTypes.mockClear();
  });

  describe('getEffectiveTypes', () => {
    it('includes default types when enabled', () => {
      const cfg: MemoryConfig = makeCfg();

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(3);
      expect(types.map((t) => t.name)).toContain('user');
      expect(types.map((t) => t.name)).toContain('project');
      expect(types.map((t) => t.name)).toContain('reference');
    });

    it('appends extra types', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'custom',
          description: 'Custom type',
          enabled: true,
        },
      ];
      const cfg: MemoryConfig = makeCfg({ extraTypes: extra });

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(4);
      expect(types.map((t) => t.name)).toContain('custom');
    });

    it('filters disabled types', () => {
      const cfg: MemoryConfig = makeCfg({ disabledTypes: ['user', 'project'] });

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('reference');
    });

    it('filters disabled extra types', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'custom',
          description: 'Custom type',
          enabled: true,
        },
      ];
      const cfg: MemoryConfig = makeCfg({ extraTypes: extra, disabledTypes: ['custom'] });

      const types = getEffectiveTypes(cfg);
      expect(types.map((t) => t.name)).not.toContain('custom');
    });

    it('respects type.enabled flag', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'disabled_custom',
          description: 'Disabled type',
          enabled: false,
        },
      ];
      const cfg: MemoryConfig = makeCfg({ extraTypes: extra });

      const types = getEffectiveTypes(cfg);
      expect(types.map((t) => t.name)).not.toContain('disabled_custom');
    });
  });

  describe('getAllTypesWithStatus', () => {
    it('returns built-in types with isBuiltIn true', () => {
      const types = getAllTypesWithStatus(makeCfg());
      const builtIn = types.filter((t) => t.isBuiltIn);
      expect(builtIn).toHaveLength(3);
      expect(builtIn.map((t) => t.name)).toEqual(['user', 'project', 'reference']);
    });

    it('marks types in disabledTypes as disabled', () => {
      const cfg = makeCfg({ disabledTypes: ['user'] });
      const types = getAllTypesWithStatus(cfg);
      expect(types.find((t) => t.name === 'user')?.disabled).toBe(true);
      expect(types.find((t) => t.name === 'project')?.disabled).toBe(false);
    });

    it('includes extra types with isBuiltIn false', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'custom', description: 'Custom type', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra });
      const types = getAllTypesWithStatus(cfg);
      expect(types).toHaveLength(4);
      const custom = types.find((t) => t.name === 'custom');
      expect(custom?.isBuiltIn).toBe(false);
      expect(custom?.description).toBe('Custom type');
    });

    it('marks disabled extra types correctly', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'custom', description: 'Custom type', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra, disabledTypes: ['custom'] });
      const types = getAllTypesWithStatus(cfg);
      expect(types.find((t) => t.name === 'custom')?.disabled).toBe(true);
    });
  });

  describe('setMemoryTypeDisabled', () => {
    it('adds name to disabledTypes when disabling', () => {
      const cfg = makeCfg();
      setMemoryTypeDisabled('user', true, cfg);
      expect(mockUpdateDisabledTypes).toHaveBeenCalledWith(['user']);
    });

    it('removes name from disabledTypes when enabling', () => {
      const cfg = makeCfg({ disabledTypes: ['user', 'project'] });
      setMemoryTypeDisabled('user', false, cfg);
      expect(mockUpdateDisabledTypes).toHaveBeenCalledWith(['project']);
    });

    it('deduplicates when adding existing entry', () => {
      const cfg = makeCfg({ disabledTypes: ['user'] });
      setMemoryTypeDisabled('user', true, cfg);
      expect(mockUpdateDisabledTypes).toHaveBeenCalledWith(['user']);
    });

    it('is no-op when enabling an already-enabled type', () => {
      const cfg = makeCfg();
      setMemoryTypeDisabled('user', false, cfg);
      expect(mockUpdateDisabledTypes).toHaveBeenCalledWith([]);
    });
  });

  describe('addMemoryExtraType', () => {
    it('adds type to extraTypes with enabled: true', () => {
      const cfg = makeCfg();
      addMemoryExtraType({ name: 'custom', description: 'Custom', enabled: true }, cfg);
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith([
        { name: 'custom', description: 'Custom', enabled: true },
      ]);
    });

    it('appends to existing extraTypes', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'existing', description: 'Existing', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra });
      addMemoryExtraType({ name: 'new_type', description: 'New', enabled: true }, cfg);
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith([
        { name: 'existing', description: 'Existing', enabled: true },
        { name: 'new_type', description: 'New', enabled: true },
      ]);
    });

    it('throws on duplicate name', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'custom', description: 'Existing', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra });
      expect(() =>
        addMemoryExtraType({ name: 'custom', description: 'Dupe', enabled: true }, cfg)
      ).toThrow('already exists');
    });
  });

  describe('updateMemoryExtraType', () => {
    it('updates existing extra type', () => {
      const extra: MemoryTypeConfig[] = [{ name: 'custom', description: 'Old', enabled: true }];
      const cfg = makeCfg({ extraTypes: extra });
      updateMemoryExtraType(
        'custom',
        { name: 'custom', description: 'Updated', enabled: true },
        cfg
      );
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith([
        { name: 'custom', description: 'Updated', enabled: true },
      ]);
    });

    it('renames an extra type', () => {
      const extra: MemoryTypeConfig[] = [{ name: 'old_name', description: 'Desc', enabled: true }];
      const cfg = makeCfg({ extraTypes: extra });
      updateMemoryExtraType(
        'old_name',
        { name: 'new_name', description: 'Desc', enabled: true },
        cfg
      );
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith([
        { name: 'new_name', description: 'Desc', enabled: true },
      ]);
    });

    it('throws if not found', () => {
      const cfg = makeCfg();
      expect(() =>
        updateMemoryExtraType('nonexistent', { name: 'x', description: 'x', enabled: true }, cfg)
      ).toThrow('not found');
    });

    it('throws on rename conflict', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'a', description: 'A', enabled: true },
        { name: 'b', description: 'B', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra });
      expect(() =>
        updateMemoryExtraType('a', { name: 'b', description: 'Overwrite', enabled: true }, cfg)
      ).toThrow('already exists');
    });
  });

  describe('deleteMemoryExtraType', () => {
    it('removes the named extra type', () => {
      const extra: MemoryTypeConfig[] = [
        { name: 'keep', description: '', enabled: true },
        { name: 'remove', description: '', enabled: true },
      ];
      const cfg = makeCfg({ extraTypes: extra });
      deleteMemoryExtraType('remove', cfg);
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith([
        { name: 'keep', description: '', enabled: true },
      ]);
    });

    it('is no-op if type not found', () => {
      const extra: MemoryTypeConfig[] = [{ name: 'a', description: '', enabled: true }];
      const cfg = makeCfg({ extraTypes: extra });
      deleteMemoryExtraType('nonexistent', cfg);
      expect(mockUpdateExtraTypes).toHaveBeenCalledWith(extra);
    });
  });
});
