import type { LLMStreamAdapter } from '../agent/agent.js';
import { findSessionIndex } from '../session/store.js';
import type { SessionEvent } from '../session/types.js';
import { readMemoryFile, resolveProjectMemoryPath, resolveUserMemoryPath, extractAutoBlock, replaceAutoBlock, mergeAutoBlocks, enforceMaxBytes, writeMemoryFileAtomic, stripMarkersForPrompt } from './storage.js';
import { resolveMemoryLLM } from './llm-resolver.js';
import { getMemoryConfig, getEffectiveTypes, updateMemoryEnabled } from './config.js';
import { extractMemory, type StructuredTranscript } from './extractor.js';
import { getWorkspaceCwd } from '../core/workspace.js';

let _runtimeEnabled: boolean | null = null;

export function setMemoryEnabled(v: boolean): void { _runtimeEnabled = v; updateMemoryEnabled(v); }
export function getMemoryEnabled(): boolean { return _runtimeEnabled ?? getMemoryConfig().enabled; }

export function loadMemoryForPrompt(cwd: string): string {
  if (!getMemoryEnabled()) return '';
  const cfg = getMemoryConfig();

  const projectPath = resolveProjectMemoryPath(cwd, cfg);
  const userPath = resolveUserMemoryPath(cfg);

  const projectContent = readMemoryFile(projectPath);
  const userContent = readMemoryFile(userPath);

  const projectAuto = extractAutoBlock(projectContent);
  const userAuto = extractAutoBlock(userContent);

  const parts = [];
  if (projectAuto) parts.push(projectAuto);
  if (userAuto) parts.push(userAuto);

  if (parts.length === 0) return '';

  const combined = parts.join('\n\n');
  const stripped = stripMarkersForPrompt(combined);

  const truncated = truncateForPrompt(stripped, cfg.promptMaxBytes);

  return truncated ? `## Long-term Memory\n\n${truncated}` : '';
}

function truncateForPrompt(content: string, maxBytes: number): string {
  const contentBytes = Buffer.byteLength(content, 'utf-8');
  if (contentBytes <= maxBytes) {
    return content;
  }

  const lines = content.split('\n');
  let result = '';
  for (const line of lines) {
    const newResult = result ? result + '\n' + line : line;
    if (Buffer.byteLength(newResult, 'utf-8') > maxBytes) {
      break;
    }
    result = newResult;
  }

  return result;
}

function buildStructuredTranscript(events: SessionEvent[]): StructuredTranscript {
  const userOnly: string[] = [];
  const userAndAssistant: string[] = [];
  const userAndTools: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'user':
        userOnly.push(`[user] ${event.content}`);
        userAndAssistant.push(`[user] ${event.content}`);
        userAndTools.push(`[user] ${event.content}`);
        break;
      case 'assistant':
        userAndAssistant.push(`[assistant] ${event.content}`);
        break;
      case 'tool_result':
        if (event.toolName === 'fetch_url' || event.toolName === 'read_file' || event.toolName === 'Read') {
          userAndTools.push(`[tool:${event.toolName}] ${event.output}`);
        }
        break;
    }
  }

  return {
    userOnly: userOnly.join('\n---\n'),
    userAndAssistant: userAndAssistant.join('\n---\n'),
    userAndTools: userAndTools.join('\n---\n'),
  };
}

export async function flushSessionToMemory(
  sessionId: string,
  llm: LLMStreamAdapter | null,
): Promise<{ written: boolean; bytes: number }> {
  if (!getMemoryEnabled()) {
    return { written: false, bytes: 0 };
  }
  const cfg = getMemoryConfig();

  const sessionIndex = findSessionIndex(sessionId);
  if (!sessionIndex) {
    return { written: false, bytes: 0 };
  }

  const cwd = sessionIndex.cwd;
  const projectPath = resolveProjectMemoryPath(cwd, cfg);
  const userPath = resolveUserMemoryPath(cfg);

  const projectContent = readMemoryFile(projectPath);
  const userContent = readMemoryFile(userPath);

  const projectAuto = extractAutoBlock(projectContent);
  const userAuto = extractAutoBlock(userContent);
  const currentAuto = [projectAuto, userAuto].filter(Boolean).join('\n\n');

  try {
    const transcriptPath = sessionIndex.cwd.split('\\').slice(0, -1).join('\\');
    let events: SessionEvent[] = [];
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { resolveSessionDir } = await import('../session/store.js');

      const sessionDir = resolveSessionDir(sessionId);
      if (!sessionDir) return { written: false, bytes: 0 };
      const jsonlPath = join(sessionDir, `${sessionId}.jsonl`);

      const content = readFileSync(jsonlPath, 'utf-8');
      events = content
        .split('\n')
        .filter((l) => l.trim() && !l.includes('"type":"session_meta"'))
        .map((l) => JSON.parse(l) as SessionEvent);
    } catch {
      return { written: false, bytes: 0 };
    }

    const transcript = buildStructuredTranscript(events);
    const types = getEffectiveTypes(cfg);

    const resolvedLlm = await resolveMemoryLLM(cfg, llm);
    if (!resolvedLlm) {
      return { written: false, bytes: 0 };
    }

    const extracted = await extractMemory({
      currentAuto,
      transcript,
      types,
      llm: resolvedLlm,
    });

    if (!extracted) {
      return { written: false, bytes: 0 };
    }

    const projectContentFresh = readMemoryFile(projectPath);
    const projectAutoFresh = extractAutoBlock(projectContentFresh);
    const merged = mergeAutoBlocks(projectAutoFresh, extracted);
    const truncated = enforceMaxBytes(merged, cfg.maxBytes);
    const newProjectContent = replaceAutoBlock(projectContentFresh, truncated);

    writeMemoryFileAtomic(projectPath, newProjectContent);

    return { written: true, bytes: Buffer.byteLength(truncated, 'utf-8') };
  } catch {
    return { written: false, bytes: 0 };
  }
}
