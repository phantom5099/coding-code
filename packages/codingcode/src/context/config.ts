import { getConfig } from '../core/workspace.js';
import type { ContextConfig } from '@codingcode/infra';

export type { ContextConfig } from '@codingcode/infra';

export function getContextConfig(): ContextConfig {
  return getConfig().context;
}
