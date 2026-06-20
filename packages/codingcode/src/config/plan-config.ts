import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { loadConfig } from '@codingcode/infra/config';

const DEFAULT_PLAN_DIR = '.codingcode/plans';

function readProjectPlanDir(projectCwd: string): string | undefined {
  const cfgPath = join(projectCwd, '.codingcode', 'config.yaml');
  if (!existsSync(cfgPath)) return undefined;
  try {
    const raw = readFileSync(cfgPath, 'utf8');
    const data = parseYaml(raw) as { plan?: { directory?: string } } | null;
    return data?.plan?.directory;
  } catch {
    return undefined;
  }
}

export function getPlanDirectory(projectCwd: string): string {
  const projectDir = readProjectPlanDir(projectCwd);
  if (projectDir) return join(projectCwd, projectDir);
  try {
    const config = loadConfig() as { plan?: { directory?: string } } | null;
    const globalDir = config?.plan?.directory;
    if (globalDir) return join(projectCwd, globalDir);
  } catch {
    /* ignore */
  }
  return join(projectCwd, DEFAULT_PLAN_DIR);
}

export function getPlanFilePath(projectCwd: string, sessionId: string): string {
  return join(getPlanDirectory(projectCwd), `${sessionId}.md`);
}

export function ensurePlanDirectory(projectCwd: string): string {
  const dir = getPlanDirectory(projectCwd);
  if (!existsSync(dir)) {
    // Lazy require to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mkdirSync } = require('fs') as typeof import('fs');
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
