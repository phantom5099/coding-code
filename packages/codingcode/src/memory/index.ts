import { Effect } from 'effect';
import type { LLMClient } from '../llm/client.js';
import { findSessionIndex, resolveSessionDir } from '../session/file-ops.js';
import type { SessionEvent } from '../session/types.js';
import {
  readMemoryFile,
  resolveMemoryPath,
  extractAutoBlock,
  replaceAutoBlock,
  mergeAutoBlocks,
  enforceMaxBytes,
  writeMemoryFileAtomic,
  stripMarkersForPrompt,
} from './storage.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { LLMFactoryService } from '../llm/factory.js';
import { getMemoryConfig, getEffectiveTypes } from './config.js';
import { updateMemoryEnabled } from '@codingcode/infra/config';
import { extractMemory } from './extractor.js';
import type { StructuredTranscript } from './types.js';

const MAX_BYTES = 16384;
const PROMPT_MAX_BYTES = 8192;

export class MemoryService extends Effect.Service<MemoryService>()('Memory', {
  effect: Effect.gen(function* () {
    const factory = yield* LLMFactoryService;
    let _runtimeEnabled: boolean | null = null;

    function getMemoryEnabled(): boolean {
      return _runtimeEnabled ?? getMemoryConfig().enabled;
    }

    function setMemoryEnabled(v: boolean): void {
      _runtimeEnabled = v;
      updateMemoryEnabled(v);
    }

    function loadMemoryForPrompt(cwd: string): string {
      if (!getMemoryEnabled()) return '';
      const cfg = getMemoryConfig();

      const projectPath = resolveMemoryPath(cwd);
      const projectContent = readMemoryFile(projectPath);
      const projectAuto = extractAutoBlock(projectContent);

      if (!projectAuto) return '';

      const stripped = stripMarkersForPrompt(projectAuto);
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
            if (
              event.toolName === 'fetch_url' ||
              event.toolName === 'read_file' ||
              event.toolName === 'Read'
            ) {
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

    async function flushSessionToMemory(
      sessionId: string,
      llm: LLMClient | null
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
      const projectPath = resolveMemoryPath(cwd);

      const projectContent = readMemoryFile(projectPath);
      const currentAuto = extractAutoBlock(projectContent);

      try {
        let events: SessionEvent[] = [];
        try {
          const { readFileSync } = await import('node:fs');
          const { join } = await import('node:path');

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

        const resolvedLlm = await Effect.runPromise(
          resolveLLM(cfg.model, llm).pipe(Effect.provideService(LLMFactoryService, factory))
        );
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
        const truncated = enforceMaxBytes(merged, MAX_BYTES);
        const newProjectContent = replaceAutoBlock(projectContentFresh, truncated);

        writeMemoryFileAtomic(projectPath, newProjectContent);

        return { written: true, bytes: Buffer.byteLength(truncated, 'utf-8') };
      } catch {
        return { written: false, bytes: 0 };
      }
    }

    return {
      getMemoryEnabled,
      setMemoryEnabled,
      loadMemoryForPrompt,
      flushSessionToMemory,
    };
  }),
}) {}
