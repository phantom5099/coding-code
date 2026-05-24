import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEffectiveTypes } from '../../src/memory/config.js';
import type { MemoryConfig, MemoryTypeConfig } from '@codingcode/infra';

describe('Memory Config', () => {
  describe('getEffectiveTypes', () => {
    it('includes default types when enabled', () => {
      const cfg: MemoryConfig = {
        enabled: true,
        model: '',
        projectFile: '',
        userFile: '',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: [],
      };

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(3);
      expect(types.map(t => t.name)).toContain('user');
      expect(types.map(t => t.name)).toContain('project');
      expect(types.map(t => t.name)).toContain('reference');
    });

    it('appends extra types', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'custom',
          description: 'Custom type',
          enabled: true,
        },
      ];
      const cfg: MemoryConfig = {
        enabled: true,
        model: '',
        projectFile: '',
        userFile: '',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: extra,
        disabledTypes: [],
      };

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(4);
      expect(types.map(t => t.name)).toContain('custom');
    });

    it('filters disabled types', () => {
      const cfg: MemoryConfig = {
        enabled: true,
        model: '',
        projectFile: '',
        userFile: '',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: ['user', 'project'],
      };

      const types = getEffectiveTypes(cfg);
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('reference');
    });

    it('filters disabled extra types', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'custom',
          description: 'Custom type',
          enabled: true,
        },
      ];
      const cfg: MemoryConfig = {
        enabled: true,
        model: '',
        projectFile: '',
        userFile: '',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: extra,
        disabledTypes: ['custom'],
      };

      const types = getEffectiveTypes(cfg);
      expect(types.map(t => t.name)).not.toContain('custom');
    });

    it('respects type.enabled flag', () => {
      const extra: MemoryTypeConfig[] = [
        {
          name: 'disabled_custom',
          description: 'Disabled type',
          enabled: false,
        },
      ];
      const cfg: MemoryConfig = {
        enabled: true,
        model: '',
        projectFile: '',
        userFile: '',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: extra,
        disabledTypes: [],
      };

      const types = getEffectiveTypes(cfg);
      expect(types.map(t => t.name)).not.toContain('disabled_custom');
    });
  });
});
