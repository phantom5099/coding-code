import { loadConfig, type MemoryConfig } from '@codingcode/infra/config';

export function getMemoryConfig(): MemoryConfig {
  return loadConfig().memory;
}
