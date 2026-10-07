import { Layer, Effect } from 'effect';
import { readTranscript } from '../session/file-ops.js';
import type { SessionEvent } from '../session/types.js';
import {
  readMemoryFile,
  resolveMemoryPath,
  enforceMaxBytes,
  writeMemoryFileAtomic,
} from './storage.js';
import { LLMService } from '../llm/port.js';
import { getMemoryConfig } from './config.js';
import { updateMemoryEnabled } from '../infra/config.js';
import { createLogger } from '../infra/logger.js';
import { extractMemory } from './extractor.js';
import { MemoryService } from './port.js';

const MAX_BYTES = 16384;
const NOT_WRITTEN = { written: false, bytes: 0 } as const;

const logger = createLogger();

export const MemoryLayer = Layer.effect(
  MemoryService,
  Effect.gen(function* () {
    const llm = yield* LLMService;
    let _runtimeEnabled: boolean | null = null;

    function isEnabled(): boolean {
      return _runtimeEnabled ?? getMemoryConfig().enabled;
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

    function loadMemoryForPromptImpl(cwd: string): string {
      if (!isEnabled()) return '';
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

    return {
      getMemoryEnabled: (): Effect.Effect<boolean> => Effect.sync(() => isEnabled()),

      setMemoryEnabled: (v: boolean): Effect.Effect<void> =>
        Effect.sync(() => {
          _runtimeEnabled = v;
          try {
            updateMemoryEnabled(v);
          } catch (e) {
            logger.error('memory: failed to persist enabled flag:', e);
          }
        }),

      loadMemoryForPrompt: (cwd: string): Effect.Effect<string> =>
        Effect.sync(() => loadMemoryForPromptImpl(cwd)),

      flushSessionToMemory: (
        sessionId: string,
        model: string,
        sessionCwd: string
      ): Effect.Effect<{ written: boolean; bytes: number }> =>
        Effect.gen(function* () {
          if (!isEnabled()) return { ...NOT_WRITTEN };
          if (!sessionCwd) return { ...NOT_WRITTEN };

          const events = readTranscript(sessionCwd, sessionId).filter(
            (e) => e.type !== 'session_meta'
          );
          if (events.length === 0) return { ...NOT_WRITTEN };

          const cfg = getMemoryConfig();
          const projectPath = resolveMemoryPath(sessionCwd);
          const current = readMemoryFile(projectPath);

          const transcript = buildTranscript(events);
          const extracted = yield* extractMemory({
            currentMemory: current,
            transcript,
            llm,
            model: cfg.model?.trim() || model,
          });
          if (!extracted) return { ...NOT_WRITTEN };

          if (readMemoryFile(projectPath) !== current) return { ...NOT_WRITTEN };

          const truncated = enforceMaxBytes(extracted, MAX_BYTES);
          if (truncated === current) return { ...NOT_WRITTEN };

          writeMemoryFileAtomic(projectPath, truncated);
          return { written: true, bytes: Buffer.byteLength(truncated, 'utf-8') };
        }).pipe(Effect.catchAllCause(() => Effect.succeed({ ...NOT_WRITTEN }))),
    };
  })
);
