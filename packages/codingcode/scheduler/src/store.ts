import { dirname } from 'path';
import { getGlobalDir } from '@codingcode/util';
import { readNamedList, writeNamedList, type NamedListFile } from '@codingcode/infra';
import type { Automation } from './types.js';

const AUTOMATIONS_FILE: NamedListFile = { fileName: 'automations', key: 'automations' };

function targetFor(configPath?: string) {
  if (!configPath) return { dir: getGlobalDir(), file: AUTOMATIONS_FILE };
  const base = configPath.replace(/\.(yaml|yml)$/i, '');
  const dir = dirname(configPath);
  const fileName = base.slice(dir.length + 1);
  return { dir, file: { fileName, key: 'automations' } };
}

export function readAutomations(configPath?: string): Automation[] {
  return readNamedList<Automation>(targetFor(configPath));
}

export function writeAutomations(automations: readonly Automation[], configPath?: string): void {
  writeNamedList(targetFor(configPath), automations);
}
