import type { ToolDefinition } from './types.js';
import type { ToolVisibilityPolicy } from './types.js';

const loaded = new Map<string, Set<string>>();
const deferredTools: ToolDefinition[] = [];

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

export function registerDeferred(tool: ToolDefinition): void {
  deferredTools.push(tool);
}

export function isLoaded(sessionId: string, toolName: string, policy?: ToolVisibilityPolicy): boolean {
  if (policy?.allowedTools && !policy.allowedTools.has(toolName)) return false;
  return getSet(sessionId).has(toolName);
}

export function listLoaded(sessionId: string): string[] {
  return Array.from(getSet(sessionId));
}

export function listUnloadedDeferred(
  sessionId: string,
  policy?: ToolVisibilityPolicy
): ToolDefinition[] {
  const set = getSet(sessionId);
  return filterByPolicy(
    deferredTools.filter((t) => !set.has(t.name)),
    policy
  );
}

export function search(
  sessionId: string,
  query: string,
  policy?: ToolVisibilityPolicy
): ToolSearchHit[] {
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
}

export function markLoaded(sessionId: string, toolNames: string[]): void {
  const set = getSet(sessionId);
  for (const name of toolNames) set.add(name);
}

export function reset(): void {
  loaded.clear();
  deferredTools.length = 0;
}

export function disposeSession(sessionId: string): void {
  loaded.delete(sessionId);
}

export class ToolSearchService {
  static isLoaded = isLoaded;
  static listLoaded = listLoaded;
  static listUnloadedDeferred = listUnloadedDeferred;
  static search = search;
  static markLoaded = markLoaded;
  static reset = reset;
  static disposeSession = disposeSession;
}
