import { loadConfig, type MemoryConfig } from '../infra/config.js';

export function getMemoryConfig(): MemoryConfig {
  return loadConfig().memory;
}
