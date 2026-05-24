import { loadConfig, DEFAULT_MEMORY_TYPES, type MemoryConfig, type MemoryTypeConfig, updateMemoryEnabled } from '@codingcode/infra';

export type { MemoryConfig, MemoryTypeConfig };
export { updateMemoryEnabled };

export function getMemoryConfig(): MemoryConfig {
  return loadConfig().memory;
}

export function getEffectiveTypes(cfg: MemoryConfig): MemoryTypeConfig[] {
  return [...DEFAULT_MEMORY_TYPES, ...cfg.extraTypes].filter(
    (t) => t.enabled && !cfg.disabledTypes.includes(t.name),
  );
}
