import type { Message, ToolDescription } from '../core/types';
import type { ToolService } from '../tools/registry';
import type { ToolSearchService } from '../agent-state/tool-search/service';

export function buildToolsForAgent(
  registry: ToolService,
  toolSearch: ToolSearchService,
  agentId: string,
): ToolDescription[] {
  const core = registry.allCore();
  const loadedDeferred = registry.allDeferred().filter(t => toolSearch.isLoaded(agentId, t.name));
  return [...core, ...loadedDeferred].map(t => ({
    name: t.name,
    description: t.description,
    parameters: (t.jsonSchema ?? {}) as Record<string, unknown>,
  }));
}

export function buildDeferredCatalogMessage(
  toolSearch: ToolSearchService,
  agentId: string,
): Message | null {
  const unloaded = toolSearch.listUnloadedDeferred(agentId);
  if (unloaded.length === 0) return null;
  const lines = unloaded.map(t =>
    `- ${t.name}: ${t.shortDescription ?? t.description.slice(0, 80)}`,
  );
  return {
    role: 'system',
    content: [
      '<available-deferred-tools>',
      'These tools are not yet loaded. Call tool_search with relevant keywords to load them before use.',
      ...lines,
      '</available-deferred-tools>',
    ].join('\n'),
  };
}
