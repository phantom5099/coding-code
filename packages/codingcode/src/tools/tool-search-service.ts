import { Effect } from 'effect';
import type { ToolDefinition } from './types.js';
import type { ToolVisibilityPolicy } from './types.js';

const loaded = new Map<string, Set<string>>();

function getSet(sessionId: string): Set<string> {
  let s = loaded.get(sessionId);
  if (!s) {
    s = new Set();
    loaded.set(sessionId, s);
  }
  return s;
}

function filterByPolicy(tools: ToolDefinition[], policy?: ToolVisibilityPolicy): ToolDefinition[] {
  if (!policy || !policy.allowedTools) return tools;
  return tools.filter((t) => policy.allowedTools!.has(t.name));
}

export interface ToolSearchHit {
  name: string;
  shortDescription?: string;
}

export class ToolSearchService extends Effect.Service<ToolSearchService>()('ToolSearchService', {
  effect: Effect.gen(function* () {
    // Deferred tools are registered externally (not from ToolService)
    const deferredTools: ToolDefinition[] = [];

    return {
      isLoaded: (sessionId: string, toolName: string, policy?: ToolVisibilityPolicy): boolean => {
        if (policy?.allowedTools && !policy.allowedTools.has(toolName)) return false;
        return getSet(sessionId).has(toolName);
      },

      listLoaded: (sessionId: string): string[] => Array.from(getSet(sessionId)),

      listUnloadedDeferred: (
        sessionId: string,
        policy?: ToolVisibilityPolicy
      ): ToolDefinition[] => {
        const set = getSet(sessionId);
        return filterByPolicy(
          deferredTools.filter((t) => !set.has(t.name)),
          policy
        );
      },

      search: (
        sessionId: string,
        query: string,
        policy?: ToolVisibilityPolicy
      ): ToolSearchHit[] => {
        const set = getSet(sessionId);
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return [];
        const candidates = filterByPolicy(deferredTools, policy);
        const hits = candidates.filter((t) => {
          if (set.has(t.name)) return false;
          const haystack = `${t.name} ${t.shortDescription ?? ''} ${t.description}`.toLowerCase();
          return tokens.every((tok) => haystack.includes(tok));
        });
        return hits.map((t) => ({ name: t.name, shortDescription: t.shortDescription }));
      },

      markLoaded: (sessionId: string, toolNames: string[]): void => {
        const set = getSet(sessionId);
        for (const name of toolNames) set.add(name);
      },

      reset: (): void => loaded.clear(),

      disposeSession: (sessionId: string): void => {
        loaded.delete(sessionId);
      },
    };
  }),
}) {}
