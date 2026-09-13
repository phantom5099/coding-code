import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Layer, Effect } from 'effect';
import { RulesService } from './port.js';

// ── Paths ──

function getGlobalRulesPath(): string {
  return path.join(os.homedir(), '.codingcode', 'rules.md');
}

function getProjectRulesPath(projectPath?: string): string {
  return path.join(projectPath ?? process.cwd(), 'AGENTS.md');
}

export const RulesLayer = Layer.effect(RulesService, Effect.sync(() => {
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
}));
