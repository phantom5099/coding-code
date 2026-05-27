import { z } from 'zod';
import type { ToolDescription } from '../core/types';
import type { ToolService } from '../tools/registry';
import type { ToolSearchService } from '../tools/tool-search-service';

export function buildToolsForAgent(
  registry: ToolService,
  toolSearch: ToolSearchService,
  sessionId: string,
  coreAllowlist?: ReadonlySet<string>,
): ToolDescription[] {
  let core = registry.allCore();
  if (coreAllowlist) {
    core = core.filter(t => coreAllowlist.has(t.name));
  }
  const loadedDeferred = registry.allDeferred().filter(t => toolSearch.isLoaded(sessionId, t.name));
  let deferred = loadedDeferred;
  if (coreAllowlist) {
    deferred = deferred.filter(t => coreAllowlist.has(t.name));
  }
  return [...core, ...deferred].map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
  }));
}

export function buildDeferredCatalogContent(
  toolSearch: ToolSearchService,
  sessionId: string,
): string | null {
  const unloaded = toolSearch.listUnloadedDeferred(sessionId);
  if (unloaded.length === 0) return null;
  const lines = unloaded.map(t =>
    `- ${t.name}: ${t.shortDescription ?? t.description.slice(0, 80)}`,
  );
  return [
    '<available-deferred-tools>',
    'These tools are not yet loaded. Call tool_search with relevant keywords to load them before use.',
    ...lines,
    '</available-deferred-tools>',
  ].join('\n');
}
