import { Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { AgentError } from '../util/error.js';
import { encodeProjectPath } from '../util/path.js';
import { assetsDirOf, assertAssetName, computePaths } from './paths.js';
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
import { sniffMediaMime } from '../util/media.js';
import type {
  SessionMetaEvent,
  UserEvent,
  AssistantEvent,
  ToolResultEvent,
  SubagentResultEvent,
  SummaryEvent,
  RollbackEvent,
  SessionEvent,
  CompactEvent,
  StoredPart,
  StoredMediaPart,
} from './types.js';
import type { SessionStoreState, SessionSummary } from './types.js';
import type { UITurn } from './types.js';
import {
  mediaKindOf,
  textOf,
  textPart,
  type IncomingMedia,
  type IncomingPart,
  type TokenUsage,
} from '../llm/types.js';
import type { ProfileName, PermissionMode } from '../util/enums.js';

import { SessionService } from './port.js';
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
  sessionJsonlPathFromCwd,
} from './file-ops.js';

function pathsFromState(state: SessionStoreState) {
  return computePaths(state.cwd, state.sessionId, state.parentSessionId);
}

function assertResumeWorkspace(cwd: string, sessionId: string, parentSessionId?: string): void {
  const expectedPath = sessionJsonlPathFromCwd(cwd, sessionId, parentSessionId);
  if (!existsSync(expectedPath)) throw AgentError.sessionNotFound(sessionId);
}

// --- UI history (moved from ui-history.ts) ---

export function filterForUI(events: SessionEvent[]): SessionEvent[] {
  const rollbackHiddenTurnIds = new Set<number>();
  const rollbackHiddenOpUuids = new Set<string>();

  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if ('turnId' in prior && prior.turnId >= ev.throughTurnId) {
        rollbackHiddenTurnIds.add(prior.turnId);
      }
      if (prior.type === 'summary' || prior.type === 'compact') {
        if ((prior as SummaryEvent | CompactEvent).endTurnId >= ev.throughTurnId) {
          rollbackHiddenOpUuids.add((prior as SummaryEvent | CompactEvent).uuid);
        }
      }
    }
  }

  return events.filter((ev) => {
    if (ev.type === 'rollback') return false;
    if (ev.type === 'summary' && rollbackHiddenOpUuids.has((ev as SummaryEvent).uuid)) return false;
    if (ev.type === 'compact' && rollbackHiddenOpUuids.has((ev as CompactEvent).uuid)) return false;
    if ('turnId' in ev && rollbackHiddenTurnIds.has(ev.turnId)) return false;
    return true;
  }) as SessionEvent[];
}

function createTurnScopedIdGenerator() {
  const counters = new Map<string, number>();
  return (prefix: string, turnId: number): string => {
    const key = `${prefix}:${turnId}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `${prefix}-${turnId}-${next}`;
  };
}

export function sessionEventsToTurns(events: SessionEvent[]): UITurn[] {
  const turnsMap = new Map<number, UITurn>();
  const nextId = createTurnScopedIdGenerator();

  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'compact' || event.type === 'rollback') continue;
    if (event.type === 'subagent_result') continue; // 结果进模型上下文，不占用户视野

    if (event.type === 'summary') {
      let turn = turnsMap.get(event.endTurnId);
      if (!turn) {
        turn = { id: String(event.endTurnId), items: [], status: 'completed' };
        turnsMap.set(event.endTurnId, turn);
      }
      turn.items.push({
        id: `summary-${event.uuid}`,
        type: 'summary',
        content: event.summaryText,
        startTurnId: event.startTurnId,
        endTurnId: event.endTurnId,
      });
      continue;
    }

    let turn = turnsMap.get(event.turnId);
    if (!turn) {
      turn = { id: String(event.turnId), items: [], status: 'completed' };
      turnsMap.set(event.turnId, turn);
    }
    switch (event.type) {
      case 'user':
        if (event.source === 'system') break;
        turn.items.push({
          id: nextId('user', event.turnId),
          type: 'message',
          role: 'user',
          parts: event.content,
        });
        break;
      case 'assistant':
        if (event.content) {
          turn.items.push({
            id: nextId('assistant', event.turnId),
            type: 'message',
            role: 'assistant',
            parts: [textPart(event.content)],
          });
        }
        for (const tc of event.toolCalls ?? []) {
          const args = tc.arguments ?? {};
          turn.items.push({
            id: tc.id,
            type: 'tool_call',
            name: tc.name,
            args,
            status: 'approved',
          });
        }
        break;
      case 'tool_result': {
        turn.items.push({
          id: `result-${event.toolCallId}`,
          type: 'tool_result',
          callId: event.toolCallId,
          name: event.toolName,
          output: event.output,
        });
        break;
      }
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function readUIHistory(sessionId: string, cwd: string): UITurn[] {
  const jsonlPath = sessionJsonlPathFromCwd(cwd, sessionId);
  if (!existsSync(jsonlPath)) return [];
  const events = readHistory(jsonlPath);
  const visibleEvents = filterForUI(events);
  return sessionEventsToTurns(visibleEvents);
}

export const SessionLayer = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const assetCache = new Map<string, string>();

    const create = (
      cwd: string,
      options: {
        model: string;
        title?: string;
        activeProfile: ProfileName;
        permissionMode: PermissionMode;
      },
      opts?: { parentSessionId?: string; agentName?: string }
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          const paths = computePaths(cwd, randomUUID(), opts?.parentSessionId);
          ensureDirs(paths.transcriptPath);

          const meta: SessionMetaEvent = {
            type: 'session_meta',
            sessionId: paths.sessionId,
            cwd: paths.cwd,
            createdAt: new Date().toISOString(),
            model: options.model,
            title: options.title ? truncateTitle(options.title) : '',
            activeProfile: options.activeProfile,
            permissionMode: options.permissionMode,
            ...(opts?.parentSessionId && { parentSessionId: opts.parentSessionId }),
            ...(opts?.agentName && { agentName: opts.agentName }),
          };
          appendLine(paths.transcriptPath, meta);

          return { ...meta, currentTurnId: 0, memorySnapshot: '', usage: undefined };
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const load = (
      cwd: string,
      sessionId: string,
      parentSessionId?: string
    ): Effect.Effect<SessionStoreState, AgentError> =>
      Effect.try({
        try: () => {
          assertResumeWorkspace(cwd, sessionId, parentSessionId);
          const paths = computePaths(cwd, sessionId, parentSessionId);
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
            : new AgentError('SESSION_IO_ERROR', `Session load failed: ${String(e)}`, e),
      });

    const recordUser = (
      state: SessionStoreState,
      content: StoredPart[],
      opts?: { steering?: boolean }
    ): Effect.Effect<UserEvent, AgentError> =>
      Effect.try({
        try: () => {
          if (!opts?.steering) state.currentTurnId += 1;
          const event: UserEvent = {
            type: 'user',
            turnId: state.currentTurnId,
            content,
            source: 'user',
          };
          const transcriptPath = pathsFromState(state).transcriptPath;
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
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const recordUserInput = (
      state: SessionStoreState,
      content: StoredPart[]
    ): Effect.Effect<UserEvent, AgentError> => recordUser(state, content, { steering: true });

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
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
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
            writeAsset(dir, asset, p.bytes);

            const kind = mediaKindOf(mimeType);
            const part: StoredMediaPart = {
              type: 'media',
              asset,
              mimeType,
              bytes: p.bytes.byteLength,
            };
            // PDF 的 filename 必填：驱动在缺省时会生成 part-N.pdf 这种无意义名字
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
            : new AgentError(
                'SESSION_IO_ERROR',
                `Failed to store input media: ${String(e)}`,
                e
              ),
      });

    /**
     * 读盘并转 data URL。内容寻址让缓存永不失效，键为 (assetsDir, asset)。
     */
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
            const bytes = readAsset(dir, asset);
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
      content: string,
      toolCalls: AssistantEvent['toolCalls'],
      usage?: TokenUsage
    ): Effect.Effect<AssistantEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: AssistantEvent = {
            type: 'assistant',
            turnId: state.currentTurnId,
            content,
            toolCalls,
            usage,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          if (usage) {
            state.usage = usage;
          }
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const recordToolResult = (
      state: SessionStoreState,
      toolName: string,
      toolCallId: string,
      output: string
    ): Effect.Effect<ToolResultEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: ToolResultEvent = {
            type: 'tool_result',
            turnId: state.currentTurnId,
            toolName,
            toolCallId,
            output,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    // 由父回合循环在 drain 点调用：终态先入 mailbox，到这里才落盘。
    // 不写 state.usage —— 子代理的用量不算进父会话。
    const recordSubagentResult = (
      state: SessionStoreState,
      result: { sessionId: string; agentName: string; content: string }
    ): Effect.Effect<SubagentResultEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: SubagentResultEvent = {
            type: 'subagent_result',
            sessionId: result.sessionId,
            agentName: result.agentName,
            content: result.content,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const appendSummary = (
      state: SessionStoreState,
      summaryText: string,
      startTurnId: number,
      endTurnId: number
    ): Effect.Effect<SummaryEvent, AgentError> =>
      Effect.try({
        try: () => {
          const event: SummaryEvent = {
            type: 'summary',
            uuid: randomUUID(),
            startTurnId,
            endTurnId,
            summaryText,
          };
          appendLine(pathsFromState(state).transcriptPath, event);
          state.usage = undefined;
          return event;
        },
        catch: (e) =>
          e instanceof AgentError
            ? e
            : new AgentError('SESSION_IO_ERROR', `Session write failed: ${String(e)}`, e),
      });

    const rollbackToTurn = (
      state: SessionStoreState,
      throughTurnId: number,
      reason: string
    ): Effect.Effect<RollbackEvent, AgentError> =>
      Effect.sync(() => {
        const event: RollbackEvent = {
          type: 'rollback',
          throughTurnId,
          reason,
        };
        const transcriptPath = pathsFromState(state).transcriptPath;
        appendLine(transcriptPath, event);
        state.usage = readLastUsage(transcriptPath);

        return event;
      });

    const forkSession = (
      state: SessionStoreState,
      atTurnId: number
    ): Effect.Effect<string, AgentError> =>
      Effect.sync(() => {
        return forkSessionImpl(pathsFromState(state).transcriptPath, atTurnId);
      });

    const renameSession = (
      state: SessionStoreState,
      text: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        state.title = text;
        rewriteSessionMeta(pathsFromState(state).transcriptPath, { title: text });
      });

    const readHistoryFromState = (state: SessionStoreState): Effect.Effect<SessionEvent[]> =>
      Effect.sync(() => readHistory(pathsFromState(state).transcriptPath));

    const listSessionsFromCwd = (cwd?: string): Effect.Effect<SessionSummary[]> =>
      Effect.sync(() => listSessions(cwd ? encodeProjectPath(cwd) : undefined));

    const setPermissionModeByAddress = (
      cwd: string,
      sessionId: string,
      mode: PermissionMode,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { permissionMode: mode });
      });

    const setActiveProfile = (
      cwd: string,
      sessionId: string,
      profile: ProfileName,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { activeProfile: profile });
      });

    // 会话级切模型：只写会话首行，不碰 config.yaml
    const setModel = (
      cwd: string,
      sessionId: string,
      model: string,
      parentSessionId?: string
    ): Effect.Effect<void, AgentError> =>
      Effect.sync(() => {
        const paths = computePaths(cwd, sessionId, parentSessionId);
        rewriteSessionMeta(paths.transcriptPath, { model });
      });

    return {
      create,
      load,
      deleteSession: (sessionId: string, cwd: string): Effect.Effect<void, AgentError> =>
        Effect.sync(() => {
          deleteSessionImpl(sessionId, cwd);
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
      recordSubagentResult,
      appendSummary,
      rollbackToTurn,

      readEvents: (transcriptPath: string): Effect.Effect<SessionEvent[], AgentError> =>
        Effect.try({
          try: () => readHistory(transcriptPath),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to read transcript ${transcriptPath}`, e),
        }),
      appendEvent: (transcriptPath: string, event: SessionEvent): Effect.Effect<void, AgentError> =>
        Effect.try({
          try: () => appendLine(transcriptPath, event),
          catch: (e) =>
            new AgentError('SESSION_IO_ERROR', `Failed to append event to ${transcriptPath}`, e),
        }),

      readUITurns: (sessionId: string, cwd: string) =>
        Effect.sync(() => readUIHistory(sessionId, cwd)),

      setPermissionMode: setPermissionModeByAddress,
      setActiveProfile,
      setModel,
    };
  })
);

function forkSessionImpl(sourceJsonlPath: string, atTurnId: number): string {
  const events = readHistory(sourceJsonlPath);
  const atIdx = events.findIndex(
    (e) => e.type === 'user' && (e as any).source !== 'system' && (e as any).turnId === atTurnId
  );

  const chain = atIdx >= 0 ? events.slice(0, atIdx + 1) : events;
  const newSessionId = randomUUID();

  const sessionsDir = dirname(sourceJsonlPath);
  const newJsonlPath = join(sessionsDir, `${newSessionId}.jsonl`);

  for (const ev of chain) {
    const cloned: any = { ...ev };

    if (cloned.type === 'session_meta') {
      cloned.sessionId = newSessionId;
    }

    appendLine(newJsonlPath, cloned);
  }

  return newSessionId;
}
