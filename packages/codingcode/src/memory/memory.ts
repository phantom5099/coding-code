import { Layer, Effect } from 'effect';
import type { LLMClient } from '../contracts/provider.js';
import { readTranscript } from '../session/file-ops.js';
import type { SessionEvent } from '../contracts/session.js';
import {
  readMemoryFile,
  resolveMemoryPath,
  enforceMaxBytes,
  writeMemoryFileAtomic,
} from './storage.js';
import { resolveLLM } from '../llm/llm-resolver.js';
import { LLMFactoryService } from '../llm/port.js';
import { getMemoryConfig } from './config.js';
import { updateMemoryEnabled } from '@codingcode/infra/config';
import { extractMemory } from './extractor.js';
import { MemoryService } from './port.js';

const MAX_BYTES = 16384;

export const MemoryLayer = Layer.effect(MemoryService, Effect.gen(function* () {
    const factory = yield* LLMFactoryService;
    let _runtimeEnabled: boolean | null = null;

    function getMemoryEnabled(): boolean {
      return _runtimeEnabled ?? getMemoryConfig().enabled;
    }

    function setMemoryEnabled(v: boolean): void {
      _runtimeEnabled = v;
      updateMemoryEnabled(v);
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

    function loadMemoryForPrompt(cwd: string): string {
      if (!getMemoryEnabled()) return '';
      const cfg = getMemoryConfig();

      const projectPath = resolveMemoryPath(cwd);
      const content = readMemoryFile(projectPath);
      if (!content) return '';

      const truncated = truncateForPrompt(content, cfg.promptMaxBytes);
      return truncated ? `## Long-term Memory\n\n${truncated}` : '';
    }

    function buildTranscript(events: SessionEvent[]): string {
      const lines: string[] = [];
      for (const event of events) {
        switch (event.type) {
          case 'user':
            lines.push(`[user] ${event.content}`);
            break;
          case 'assistant':
            lines.push(`[assistant] ${event.content}`);
            break;
          case 'tool_result':
            if (
              event.toolName === 'fetch_url' ||
              event.toolName === 'read_file' ||
              event.toolName === 'Read'
            ) {
              lines.push(`[tool:${event.toolName}] ${event.output}`);
            }
            break;
        }
      }
      return lines.join('\n');
    }

    async function flushSessionToMemory(
      sessionId: string,
      llm: LLMClient | null,
      sessionCwd: string
    ): Promise<{ written: boolean; bytes: number }> {
      if (!getMemoryEnabled()) {
        return { written: false, bytes: 0 };
      }
      if (!sessionCwd) {
        return { written: false, bytes: 0 };
      }

      let events: SessionEvent[];
      try {
        events = readTranscript(sessionCwd, sessionId).filter((e) => e.type !== 'session_meta');
      } catch {
        return { written: false, bytes: 0 };
      }
      if (events.length === 0) {
        return { written: false, bytes: 0 };
      }

      const cfg = getMemoryConfig();
      const projectPath = resolveMemoryPath(sessionCwd);
      const current = readMemoryFile(projectPath);

      try {
        const transcript = buildTranscript(events);

        const resolvedLlm = await Effect.runPromise(
          resolveLLM(cfg.model, llm).pipe(Effect.provideService(LLMFactoryService, factory))
        );
        if (!resolvedLlm) {
          return { written: false, bytes: 0 };
        }

        const extracted = await extractMemory({
          currentMemory: current,
          transcript,
          llm: resolvedLlm,
        });
        if (!extracted) {
          return { written: false, bytes: 0 };
        }

        // 提取期间文件被手动改动则放弃本次写入
        if (readMemoryFile(projectPath) !== current) {
          return { written: false, bytes: 0 };
        }

        const truncated = enforceMaxBytes(extracted, MAX_BYTES);
        if (truncated === current) {
          return { written: false, bytes: 0 };
        }

        writeMemoryFileAtomic(projectPath, truncated);
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
}));
