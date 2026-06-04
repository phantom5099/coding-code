import { z } from 'zod';
import type { ToolDescription } from '../tools/types';
import type { AgentProfile } from '../subagent/registry';
import type { ToolVisibilityPolicy } from '../tools/visibility';
import type { ToolSearchService } from '../tools/tool-search-service';

export function buildToolsForAgent(
  resolveTools: (input: {
    projectPath: string;
    sessionId: string;
    profile: AgentProfile;
    policy: ToolVisibilityPolicy;
  }) => ToolDescription[],
  params: {
    projectPath: string;
    sessionId: string;
    profile: AgentProfile;
    policy: ToolVisibilityPolicy;
  }
): ToolDescription[] {
  return resolveTools(params);
}

export function buildDeferredCatalogContent(
  toolSearch: ToolSearchService,
  sessionId: string,
  policy?: ToolVisibilityPolicy
): string | null {
  const unloaded = toolSearch.listUnloadedDeferred(sessionId, policy);
  if (unloaded.length === 0) return null;
  const lines = unloaded.map(
    (t) => `- ${t.name}: ${t.shortDescription ?? t.description.slice(0, 80)}`
  );
  return [
    '<available-deferred-tools>',
    'These tools are not yet loaded. Call tool_search with relevant keywords to load them before use.',
    ...lines,
    '</available-deferred-tools>',
  ].join('\n');
}
