import * as fs from 'node:fs';
import * as path from 'node:path';
import { Layer, Effect } from 'effect';
import { RulesService } from './port.js';
import { getGlobalDir, normalizePath } from '@codingcode/util';

function getGlobalRulesPath(): string {
  return path.join(getGlobalDir(), 'rules.md');
}

function getProjectRulesPath(projectPath: string): string {
  return path.join(projectPath, 'AGENTS.md');
}

function normalizeProjectKey(projectPath?: string): string {
  return normalizePath(projectPath ?? process.cwd());
}

export const RulesLayer = Layer.effect(
  RulesService,
  Effect.sync(() => {
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

    function getProjectRules(key: string): string {
      if (_projectRulesCache.has(key)) return _projectRulesCache.get(key)!;
      let content = '';
      try {
        content = fs.readFileSync(getProjectRulesPath(key), 'utf-8').trim();
      } catch {
        // not found
      }
      _projectRulesCache.set(key, content);
      return content;
    }

    function buildAllRules(key: string): string {
      const parts: string[] = [];
      const global = getGlobalRules();
      const project = getProjectRules(key);
      if (global) parts.push(`## Global Rules\n\n${global}`);
      if (project) parts.push(`## Project-level Rules\n\n${project}`);
      return parts.join('\n\n');
    }

    return {
      getAllRules: (projectPath?: string): Effect.Effect<string> =>
        Effect.sync(() => {
          const key = normalizeProjectKey(projectPath);
          const cached = _allRulesCache.get(key);
          if (cached !== undefined) return cached;
          const result = buildAllRules(key);
          _allRulesCache.set(key, result);
          return result;
        }),

      evictProjectRules: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const key = normalizeProjectKey(projectPath);
          _projectRulesCache.delete(key);
          _allRulesCache.delete(key);
        }),
    };
  })
);
