import { Effect } from 'effect';
import { ToolService } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';

const loaded = new Map<string, Set<string>>();

function getSet(agentId: string): Set<string> {
  let s = loaded.get(agentId);
  if (!s) { s = new Set(); loaded.set(agentId, s); }
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
      isLoaded: (agentId: string, toolName: string): boolean => getSet(agentId).has(toolName),

      listLoaded: (agentId: string): string[] => Array.from(getSet(agentId)),

      listUnloadedDeferred: (agentId: string): ToolDefinition[] => {
        const set = getSet(agentId);
        return tools.allDeferred().filter(t => !set.has(t.name));
      },

      search: (agentId: string, query: string): ToolSearchHit[] => {
        const set = getSet(agentId);
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
