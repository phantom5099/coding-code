import { Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import {
  AgentError,
  encodeProjectPath,
  sniffMediaMime,
  type PermissionMode,
} from '@codingcode/util';
import { assetsDirOf, assertAssetName, computePaths, transcriptPathOf } from './paths.js';
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_PER_TURN,
  MAX_TEXT_CHARS,
  assetNameFor,
  mimeTypeFromAssetName,
  readAsset,
  readAudioDurationSec,
  readImageSize,
  writeAsset,
} from './assets.js';
import type {
  AssistantEvent,
  CreateSessionCommand,
  RollbackEvent,
  SessionEvent,
  SessionKey,
  SessionLocator,
  SessionMeta,
  SessionMetaEvent,
  SessionStoreState,
  SessionSummary,
  StoredMediaPart,
  StoredPart,
  SummaryEvent,
  ToolResultEvent,
  UITurn,
  UserEvent,
} from './types.js';
import { mediaKindOf, textOf, type IncomingMedia, type IncomingPart } from '@codingcode/model';
import {
  SessionService,
  type AssistantRecordInput,
  type RollbackRecordInput,
  type SummaryRecordInput,
  type ToolResultRecordInput,
} from './port.js';
import { filterForUI, sessionEventsToTurns } from './view.js';
import {
  ensureDirs,
  readHistory,
  appendLine,
  listSessions,
  readSessionMeta,
  rewriteSessionMeta,
  readLastTurnId,
  readLastUsage,
  truncateTitle,
  deleteSession as deleteSessionImpl,
} from './file-ops.js';

function readUIHistory(key: SessionKey): UITurn[] {
  const jsonlPath = transcriptPathOf(key);
  if (!existsSync(jsonlPath)) return [];
  const events = readHistory(jsonlPath);
  return sessionEventsToTurns(filterForUI(events));
}

export const SessionLayer = Layer.effect(
  SessionService,
  Effect.sync(() => {
    const assetCache = new Map<string, string>();

    const create = (cmd: CreateSessionCommand): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const lineage = cmd.lineage;
          const subagent = cmd.subagent;
          const paths = computePaths({
            ...lineage,
            cwd: cmd.cwd,
            sessionId: randomUUID(),
          });
          ensureDirs(paths.transcriptPath);

          const meta: SessionMeta = {
            sessionId: paths.sessionId,
            cwd: paths.cwd,
            createdAt: new Date().toISOString(),
            model: cmd.model,
            title: cmd.title ? truncateTitle(cmd.title) : '',
            permissionMode: cmd.permissionMode,
            ...(lineage?.parentSessionId && { parentSessionId: lineage.parentSessionId }),
            ...(lineage?.parentSessionId &&
              lineage.parentChain &&
              lineage.parentChain.length > 0 && { parentChain: [...lineage.parentChain] }),
            ...(subagent?.agentName && { agentName: subagent.agentName }),
            ...(subagent?.description && { description: subagent.description }),
            ...(lineage?.parentSessionId &&
              subagent?.systemPrompt && { systemPrompt: subagent.systemPrompt }),
          };
          const event: SessionMetaEvent = { type: 'session_meta', ...meta };
          appendLine(paths.transcriptPath, event);

          return { ...meta, currentTurnId: 0, memorySnapshot: '', usage: undefined };
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const load = (locator: SessionLocator): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const paths = computePaths(locator);
          if (!existsSync(paths.transcriptPath)) throw AgentError.sessionNotFound(locator.sessionId);
          ensureDirs(paths.transcriptPath);

          const meta = readSessionMeta(paths.transcriptPath);
          if (!meta) throw new Error('Session file missing session_meta');

          return {
            ...meta,
            currentTurnId: readLastTurnId(paths.transcriptPath),
            memorySnapshot: '',
            usage: readLastUsage(paths.transcriptPath),
          };
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session load failed: ${String(e)}`, { cause: e }),
      });

    const appendUserEvent = (
      state: SessionStoreState,
      content: StoredPart[],
      incrementTurn: boolean
    ): Effect.Effect<UserEvent, AgentError> =>
      Effect.try({
        try: () => {
          if (incrementTurn) state.currentTurnId += 1;
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
            source: 'user',
          };
          const transcriptPath = computePaths(state).transcriptPath;
          appendLine(transcriptPath, event);
          if (!state.title) {
            const derived = truncateTitle(textOf(content));
            if (derived) {
              rewriteSessionMeta(transcriptPath, { title: derived });
              state.title = derived;
            }
          }
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const recordUser = (state: SessionStoreState, content: StoredPart[]) =>
      appendUserEvent(state, content, true);

    const recordUserInput = (state: SessionStoreState, content: StoredPart[]) =>
      appendUserEvent(state, content, false);

    const recordSystem = (
      state: SessionStoreState,
      content: StoredPart[]
    ): Effect.Effect<UserEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
            source: 'system',
          };
          appendLine(computePaths(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const materializeInput = (
      state: SessionStoreState,
      parts: readonly IncomingPart[]
    ): Effect.Effect<StoredPart[], AgentError> =>
      Effect.try({
        try: () => {
          const media = parts.filter((p): p is IncomingMedia => p.type === 'media');
          if (media.length > MAX_MEDIA_PER_TURN) {
            throw AgentError.invalidInput(
              `Too many media attachments in one turn: ${media.length} > ${MAX_MEDIA_PER_TURN}`
            );
          }

          const dir = media.length > 0 ? assetsDirOf(state.cwd) : '';
          const out: StoredPart[] = [];
          for (const p of parts) {
            if (p.type === 'text') {
              if (p.text.length > MAX_TEXT_CHARS) {
                throw AgentError.invalidInput(
                  `Input text too long: ${p.text.length} > ${MAX_TEXT_CHARS}`
                );
              }
              out.push({ type: 'text', text: p.text });
              continue;
            }

            if (p.bytes.byteLength > MAX_MEDIA_BYTES) {
              throw AgentError.invalidInput(
                `Media too large: ${p.bytes.byteLength} > ${MAX_MEDIA_BYTES}`
              );
            }
            const mimeType = sniffMediaMime(p.bytes);
            if (!mimeType) {
              throw AgentError.invalidInput('Unsupported media: bytes are not in the whitelist');
            }

            const asset = assetNameFor(p.bytes, mimeType);
            writeAsset({ dir, name: asset }, p.bytes);

            const kind = mediaKindOf(mimeType);
            const part: StoredMediaPart = {
              type: 'media',
              asset,
              mimeType,
              bytes: p.bytes.byteLength,
            };
            if (p.filename) part.filename = p.filename;
            else if (kind === 'file') part.filename = asset;
            if (kind === 'image') {
              const size = readImageSize(p.bytes, mimeType);
              if (size) {
                part.width = size.width;
                part.height = size.height;
              }
            } else if (kind === 'audio') {
              const durationSec = readAudioDurationSec(p.bytes, mimeType);
              if (durationSec !== null) part.durationSec = durationSec;
            }
            out.push(part);
          }
          return out;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Failed to store input media: ${String(e)}`, {
                cause: e,
              }),
      });

    const resolveAssets = (
      cwd: string,
      assets: readonly string[]
    ): Effect.Effect<Map<string, string>, AgentError> =>
      Effect.sync(() => {
        const dir = assetsDirOf(cwd);
        const resolved = new Map<string, string>();
        for (const asset of assets) {
          const cacheKey = `${dir}\u0000${asset}`;
          const cached = assetCache.get(cacheKey);
          if (cached !== undefined) {
            resolved.set(asset, cached);
            continue;
          }
          try {
            assertAssetName(asset);
            const bytes = readAsset({ dir, name: asset });
            const url = `data:${mimeTypeFromAssetName(asset)};base64,${Buffer.from(bytes).toString('base64')}`;
            assetCache.set(cacheKey, url);
            resolved.set(asset, url);
          } catch {
            /* 资产缺失或不可读：跳过，出网时降级成文本标记 */
          }
        }
        return resolved;
      });

    const recordAssistant = (
      state: SessionStoreState,
      entry: AssistantRecordInput
    ): Effect.Effect<AssistantEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: AssistantEvent = {
            type: 'assistant',
            turnId: state.currentTurnId,
            content: entry.content,
            reasoning: entry.reasoning,
            toolCalls: entry.toolCalls,
            usage: entry.usage,
          };
          appendLine(computePaths(state).transcriptPath, event);
          if (entry.usage) state.usage = entry.usage;
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const recordToolResult = (
      state: SessionStoreState,
      result: ToolResultRecordInput
    ): Effect.Effect<ToolResultEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: ToolResultEvent = {
            type: 'tool_result',
            turnId: state.currentTurnId,
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            output: result.output,
          };
          appendLine(computePaths(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const appendSummary = (
      state: SessionStoreState,
      summary: SummaryRecordInput
    ): Effect.Effect<SummaryEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: SummaryEvent = {
            type: 'summary',
            uuid: randomUUID(),
            startTurnId: summary.startTurnId,
            endTurnId: summary.endTurnId,
            summaryText: summary.summaryText,
          };
          appendLine(computePaths(state).transcriptPath, event);
          state.usage = undefined;
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, { cause: e }),
      });

    const rollbackToTurn = (
      state: SessionStoreState,
      cmd: RollbackRecordInput
    ): Effect.Effect<RollbackEvent, AgentError> =>
      Effect.sync(() => {
        const event: RollbackEvent = {
          type: 'rollback',
          throughTurnId: cmd.throughTurnId,
          reason: cmd.reason,
        };
        const transcriptPath = computePaths(state).transcriptPath;
        appendLine(transcriptPath, event);
        state.usage = readLastUsage(transcriptPath);
        return event;
      });

    const forkSession = (
      state: SessionStoreState,
      atTurnId: number
    ): Effect.Effect<string, AgentError> =>
      Effect.sync(() => forkSessionImpl(computePaths(state).transcriptPath, atTurnId));

    const renameSession = (
      state: SessionStoreState,
      text: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        state.title = text;
        rewriteSessionMeta(computePaths(state).transcriptPath, { title: text });
      });

    const readHistoryFromState = (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
      Effect.sync(() => readHistory(computePaths(state).transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionSummary[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const setPermissionMode = (
      locator: SessionLocator,
      mode: PermissionMode
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        rewriteSessionMeta(computePaths(locator).transcriptPath, { permissionMode: mode });
      });

    const setModel = (locator: SessionLocator, model: string): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        rewriteSessionMeta(computePaths(locator).transcriptPath, { model });
      });

    return {
      create,
      load,
      deleteSession: (key: SessionKey): Effect.Effect<void, AgentError> =>
        Effect.sync(() => {
          deleteSessionImpl(key);
        }),
      forkSession,
      renameSession,
      listSessions: listSessionsFromCwd,

      readHistory: readHistoryFromState,
      materializeInput,
      resolveAssets,
      recordUser,
      recordUserInput,
      recordSystem,
      recordAssistant,
      recordToolResult,
      appendSummary,
      rollbackToTurn,

      readEvents: (locator: SessionLocator): Effect.Effect<SessionEvent[], AgentError> => {
        const transcriptPath = transcriptPathOf(locator);
        return Effect.try({
          try: () => readHistory(transcriptPath),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to read transcript ${transcriptPath}`, {
              cause: e,
            }),
        });
      },
      appendEvent: (locator: SessionLocator, event: SessionEvent): Effect.Effect<void, AgentError> => {
        const transcriptPath = transcriptPathOf(locator);
        return Effect.try({
          try: () => appendLine(transcriptPath, event),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to append event to ${transcriptPath}`, {
              cause: e,
            }),
        });
      },

      readUITurns: (key: SessionKey) => Effect.sync(() => readUIHistory(key)),

      setPermissionMode,
      setModel,
    };
  })
);

function forkSessionImpl(sourceJsonlPath: string, atTurnId: number): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = events.findIndex(
    (e) => e.type === 'user' && e.source !== 'system' && e.turnId === atTurnId
  );

  const chain = atIdx >= 0 ? events.slice(0, atIdx + 1) : events;
  const newSessionId = randomUUID();

  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);

  for (const ev of chain) {
    const cloned: SessionEvent =
      ev.type === 'session_meta' ? { ...ev, sessionId: newSessionId } : { ...ev };
    appendLine(newJsonlPath, cloned);
  }

  return newSessionId;
}
