import { Layer, Effect } from 'effect';
import { readTranscript, type SessionEvent } from '@codingcode/session';
import { LLMService, textOf } from '@codingcode/model';
import {
  readMemoryFile,
  resolveMemoryPath,
  enforceMaxBytes,
  truncateByLines,
  writeMemoryFileAtomic,
} from './storage.js';
import { getMemoryConfig } from './config.js';
import {
  createLogger,
  updateMemoryEnabled,
  updateMemoryModel,
  type MemoryConfig,
} from '@codingcode/infra';
import { extractMemory } from './extractor.js';
import {
  MemoryService,
  type FlushSessionMemoryCommand,
  type MemoryFlushResult,
} from './port.js';

const MAX_BYTES = 16384;
const NOT_WRITTEN: MemoryFlushResult = { written: false, bytes: 0 };
const TRANSCRIPT_INCLUDED_TOOLS: ReadonlySet<string> = new Set(['fetch_url', 'read_file', 'Read']);

const logger = createLogger();

export const MemoryLayer = Layer.effect(
  MemoryService,
  Effect.gen(function* () {
    const llm = yield* LLMService;
    let _runtimeEnabled: boolean | null = null;

    function isEnabled(): boolean {
      return _runtimeEnabled ?? getMemoryConfig().enabled;
    }

    function loadMemoryForPromptImpl(cwd: string): string {
      if (!isEnabled()) return '';
      const cfg = getMemoryConfig();

      const projectPath = resolveMemoryPath(cwd);
      const content = readMemoryFile(projectPath);
      if (!content) return '';

      const truncated = truncateByLines(content, cfg.promptMaxBytes);
      return truncated ? `## Long-term Memory\n\n${truncated}` : '';
    }

    function buildTranscript(events: SessionEvent[]): string {
      const lines: string[] = [];
      for (const event of events) {
        switch (event.type) {
          case 'user':
            lines.push(`[user] ${textOf(event.content)}`);
            break;
          case 'assistant':
            lines.push(`[assistant] ${event.content}`);
            break;
          case 'tool_result':
            if (TRANSCRIPT_INCLUDED_TOOLS.has(event.toolName)) {
              lines.push(`[tool:${event.toolName}] ${event.output}`);
            }
            break;
        }
      }
      return lines.join('\n');
    }

    return {
      getConfig: (): Effect.Effect<MemoryConfig> =>
        Effect.sync(() => ({
          ...getMemoryConfig(),
          enabled: isEnabled(),
        })),

      getMemoryEnabled: (): Effect.Effect<boolean> => Effect.sync(() => isEnabled()),

      setMemoryEnabled: (enabled: boolean): Effect.Effect<void> =>
        Effect.sync(() => {
          _runtimeEnabled = enabled;
          try {
            updateMemoryEnabled(enabled);
          } catch (e) {
            logger.error('memory: failed to persist enabled flag:', e);
          }
        }),

      setMemoryModel: (model: string): Effect.Effect<void> =>
        Effect.sync(() => {
          updateMemoryModel(model);
        }),

      loadMemoryForPrompt: (cwd: string): Effect.Effect<string> =>
        Effect.sync(() => loadMemoryForPromptImpl(cwd)),

      flushSessionToMemory: (cmd: FlushSessionMemoryCommand): Effect.Effect<MemoryFlushResult> =>
        Effect.gen(function* () {
          if (!isEnabled()) return { ...NOT_WRITTEN };
          if (!cmd.session.cwd) return { ...NOT_WRITTEN };

          const events = readTranscript(cmd.session).filter((e) => e.type !== 'session_meta');
          if (events.length === 0) return { ...NOT_WRITTEN };

          const cfg = getMemoryConfig();
          const projectPath = resolveMemoryPath(cmd.session.cwd);
          const current = readMemoryFile(projectPath);

          const transcript = buildTranscript(events);
          const extracted = yield* extractMemory(
            {
              currentMemory: current,
              transcript,
              model: cfg.model?.trim() || cmd.model,
            },
            llm
          );
          if (!extracted) return { ...NOT_WRITTEN };

          if (readMemoryFile(projectPath) !== current) return { ...NOT_WRITTEN };

          const truncated = enforceMaxBytes(extracted, MAX_BYTES);
          if (truncated === current) return { ...NOT_WRITTEN };

          writeMemoryFileAtomic({ path: projectPath, content: truncated });
          return { written: true, bytes: Buffer.byteLength(truncated, 'utf-8') };
        }).pipe(Effect.catchAllCause(() => Effect.succeed({ ...NOT_WRITTEN }))),
    };
  })
);
