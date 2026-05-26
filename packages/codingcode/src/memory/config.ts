import { DEFAULT_MEMORY_TYPES, type MemoryConfig, type MemoryTypeConfig, updateMemoryEnabled, updateMemoryDisabledTypes, updateMemoryExtraTypes } from '@codingcode/infra';
import { getConfig } from '../core/workspace.js';

export type { MemoryConfig, MemoryTypeConfig };
export { updateMemoryEnabled };

export function getMemoryConfig(): MemoryConfig {
  return getConfig().memory;
}

export function getEffectiveTypes(cfg: MemoryConfig): MemoryTypeConfig[] {
  return [...DEFAULT_MEMORY_TYPES, ...cfg.extraTypes].filter(
    (t) => t.enabled && !cfg.disabledTypes.includes(t.name),
  );
}

export interface MemoryTypeEntry {
  name: string;
  description: string;
  isBuiltIn: boolean;
  disabled: boolean;
}

export function getAllTypesWithStatus(cfg?: MemoryConfig): MemoryTypeEntry[] {
  const config = cfg ?? getMemoryConfig();
  const builtIn: MemoryTypeEntry[] = DEFAULT_MEMORY_TYPES.map(t => ({
    name: t.name,
    description: t.description,
    isBuiltIn: true,
    disabled: config.disabledTypes.includes(t.name),
  }));
  const custom: MemoryTypeEntry[] = config.extraTypes.map(t => ({
    name: t.name,
    description: t.description,
    isBuiltIn: false,
    disabled: config.disabledTypes.includes(t.name),
  }));
  return [...builtIn, ...custom];
}

export function setMemoryTypeDisabled(name: string, disabled: boolean, cfg?: MemoryConfig): void {
  const config = cfg ?? getMemoryConfig();
  const disabledTypes = disabled
    ? [...new Set([...config.disabledTypes, name])]
    : config.disabledTypes.filter(n => n !== name);
  updateMemoryDisabledTypes(disabledTypes);
}

export function addMemoryExtraType(type: MemoryTypeConfig, cfg?: MemoryConfig): void {
  const config = cfg ?? getMemoryConfig();
  if (config.extraTypes.some(t => t.name === type.name)) {
    throw new Error(`Memory type '${type.name}' already exists`);
  }
  const updated = [...config.extraTypes, { ...type, enabled: true }];
  updateMemoryExtraTypes(updated);
}

export function updateMemoryExtraType(name: string, type: MemoryTypeConfig, cfg?: MemoryConfig): void {
  const config = cfg ?? getMemoryConfig();
  const idx = config.extraTypes.findIndex(t => t.name === name);
  if (idx === -1) throw new Error(`Memory type '${name}' not found`);
  const updated = [...config.extraTypes];
  if (type.name !== name && config.extraTypes.some(t => t.name === type.name)) {
    throw new Error(`Memory type '${type.name}' already exists`);
  }
  updated[idx] = { ...type, enabled: true };
  updateMemoryExtraTypes(updated);
}

export function deleteMemoryExtraType(name: string, cfg?: MemoryConfig): void {
  const config = cfg ?? getMemoryConfig();
  const updated = config.extraTypes.filter(t => t.name !== name);
  updateMemoryExtraTypes(updated);
}
