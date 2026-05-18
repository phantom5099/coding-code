import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

export interface AppConfig {
  server: {
    port: number;
  };
  maxSteps: number;
  models: Record<string, {
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
  }>;
  activeModel?: string;
  roles: Record<string, {
    systemPrompt: string;
    availableTools: string[];
  }>;
  activeRole?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 8080,
  },
  maxSteps: 50,
  models: {},
  roles: {},
};

export function loadConfig(configPath?: string): AppConfig {
  const paths = configPath
    ? [configPath]
    : [resolve(process.cwd(), 'codingcode.yaml'), resolve(process.cwd(), 'codingcode.yml')];

  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      return { ...DEFAULT_CONFIG, ...(parseYaml(raw) as Partial<AppConfig>) };
    }
  }
  return DEFAULT_CONFIG;
}
