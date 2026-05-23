import { z } from 'zod';
import type { ToolDescription, Message } from '../core/types';
import type { ToolService } from '../tools/registry';
import type { ToolSearchService } from '../tools/tool-search-service';
import type { ToolDedupService } from '../tools/dedup/service';

export function buildToolsForAgent(
  registry: ToolService,
  toolSearch: ToolSearchService,
  agentId: string,
  coreAllowlist?: ReadonlySet<string>,
): ToolDescription[] {
  let core = registry.allCore();
  if (coreAllowlist) {
    core = core.filter(t => coreAllowlist.has(t.name));
  }
  const loadedDeferred = registry.allDeferred().filter(t => toolSearch.isLoaded(agentId, t.name));
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
  agentId: string,
): string | null {
  const unloaded = toolSearch.listUnloadedDeferred(agentId);
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

export function buildRepeatReminder(
  dedup: ToolDedupService,
  agentId: string,
): Message | null {
  const dups = dedup.summary(agentId).filter(d => d.count >= 2);
  if (dups.length === 0) return null;
  const lines = dups.map(d => {
    const argsStr = JSON.stringify(d.args).slice(0, 100);
    return `- ${d.name} ${argsStr} (×${d.count})`;
  });
  return {
    role: 'system',
    content: [
      '<repeated-tool-calls>',
      'You recently repeated identical tool calls. The cached result has not changed. Either use prior output or change parameters.',
      ...lines,
      '</repeated-tool-calls>',
    ].join('\n'),
  };
}
