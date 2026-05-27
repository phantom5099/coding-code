import { Effect } from 'effect';
import { ToolService } from './registry';
import type { ToolDefinition } from './types';

const loaded = new Map<string, Set<string>>();

function getSet(sessionId: string): Set<string> {
  let s = loaded.get(sessionId);
  if (!s) { s = new Set(); loaded.set(sessionId, s); }
  return s;
}

export interface ToolSearchHit {
  name: string;
  shortDescription?: string;
}

export class ToolSearchService extends Effect.Service<ToolSearchService>()('ToolSearchService', {
  effect: Effect.gen(function* () {
    const tools = yield* ToolService;
    return {
      isLoaded: (sessionId: string, toolName: string): boolean => getSet(sessionId).has(toolName),

      listLoaded: (sessionId: string): string[] => Array.from(getSet(sessionId)),

      listUnloadedDeferred: (sessionId: string): ToolDefinition[] => {
        const set = getSet(sessionId);
        return tools.allDeferred().filter(t => !set.has(t.name));
      },

      search: (sessionId: string, query: string): ToolSearchHit[] => {
        const set = getSet(sessionId);
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return [];
        const hits = tools.allDeferred().filter(t => {
          if (set.has(t.name)) return false;
          const haystack = `${t.name} ${t.shortDescription ?? ''} ${t.description}`.toLowerCase();
          return tokens.every(tok => haystack.includes(tok));
        });
        for (const t of hits) set.add(t.name);
        return hits.map(t => ({ name: t.name, shortDescription: t.shortDescription }));
      },

      reset: (): void => loaded.clear(),
    };
  }),
}) {}
