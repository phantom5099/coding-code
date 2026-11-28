import { loadConfig, type MemoryConfig } from '@codingcode/infra';

export function getMemoryConfig(): MemoryConfig {
  return loadConfig().memory;
}
