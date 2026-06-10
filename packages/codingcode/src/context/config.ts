import { getConfig } from '../core/workspace.js';
import type { ContextConfig } from '@codingcode/infra/config';

export type { ContextConfig } from '@codingcode/infra/config';

export function getContextConfig(): ContextConfig {
  return getConfig().context;
}
