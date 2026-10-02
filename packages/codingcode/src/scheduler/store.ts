import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getGlobalDir } from '../core/path.js';
import type { Automation } from '../contracts/automation.js';

interface AutomationsFile {
  automations: Automation[];
}

function getAutomationsPath(): string {
  return join(getGlobalDir(), 'automations.yaml');
}

export function readAutomations(configPath?: string): Automation[] {
  const p = configPath ?? getAutomationsPath();
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = parseYaml(raw) as AutomationsFile;
    return parsed.automations ?? [];
  } catch {
    return [];
  }
}

export function writeAutomations(automations: Automation[], configPath?: string): void {
  const p = configPath ?? getAutomationsPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: AutomationsFile = { automations };
  writeFileSync(p, stringifyYaml(data), 'utf8');
}
