import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { Effect } from 'effect';

// ── Paths ──

function getGlobalRulesPath(): string {
  return path.join(os.homedir(), '.codingcode', 'rules.md');
}

function getProjectRulesPath(projectPath?: string): string {
  return path.join(projectPath ?? process.cwd(), 'AGENTS.md');
}

export class RulesService extends Effect.Service<RulesService>()('Rules', {
  sync: () => {
    let _globalRules: string | null = null;
    const _projectRulesCache = new Map<string, string>();
    const _allRulesCache = new Map<string, string>();

    function getGlobalRules(): string {
      if (_globalRules !== null) return _globalRules;
      try {
        _globalRules = fs.readFileSync(getGlobalRulesPath(), 'utf-8').trim();
      } catch {
        _globalRules = '';
      }
      return _globalRules;
    }

    function getProjectRules(projectPath?: string): string {
      const key = projectPath ?? process.cwd();
      if (_projectRulesCache.has(key)) return _projectRulesCache.get(key)!;
      let content = '';
      try {
        content = fs.readFileSync(getProjectRulesPath(projectPath), 'utf-8').trim();
      } catch {
        // not found
      }
      _projectRulesCache.set(key, content);
      return content;
    }

    function buildAllRules(projectPath?: string): string {
      const parts: string[] = [];
      const global = getGlobalRules();
      const project = getProjectRules(projectPath);
      if (global) parts.push(`## Global Rules\n\n${global}`);
      if (project) parts.push(`## Project-level Rules\n\n${project}`);
      return parts.join('\n\n');
    }

    return {
      getAllRules(projectPath?: string): string {
        const key = projectPath ?? process.cwd();
        const cached = _allRulesCache.get(key);
        if (cached !== undefined) return cached;
        const result = buildAllRules(projectPath);
        _allRulesCache.set(key, result);
        return result;
      },

      evictProjectRules(projectPath: string): void {
        _projectRulesCache.delete(projectPath);
        _allRulesCache.delete(projectPath);
      },
    };
  },
}) {}

// ── Clear ──

export function clearGlobalRules(): void {
  try {
    fs.unlinkSync(getGlobalRulesPath());
  } catch {
    // file may not exist
  }
}

export function clearProjectRules(projectPath?: string): void {
  try {
    fs.unlinkSync(getProjectRulesPath(projectPath));
  } catch {
    // file may not exist
  }
}

// ── Edit ──

export function editInEditor(filePath: string): boolean {
  const editor =
    process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vim');

  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', editor, filePath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      spawn(editor, [filePath], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export function editGlobalRules(): boolean {
  const p = getGlobalRulesPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', 'utf-8');
  }
  return editInEditor(p);
}

export function editProjectRules(projectPath?: string): boolean {
  const p = getProjectRulesPath(projectPath);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', 'utf-8');
  }
  return editInEditor(p);
}
