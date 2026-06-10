import { useEffect, useCallback, useRef } from 'react';
import { useGlobalStore, type ModelEntry } from '../stores/global.store';
import { agentClient } from '../lib/core-api';
import type { StreamChunk } from '@codingcode/core/client/types';
import { ApiError } from '../lib/api';
import {
  listModels,
  listSessions,
  getSessionHistory,
  createSession as createServerSession,
  deleteSession,
  sendApprovalResponse,
  getCheckpointDiff,
  revertCheckpointFile,
  revertCheckpointFiles,
  revertCheckpointAgentFiles,
  revertCheckpointAllFiles,
  previewRollbackDiff,
  rollbackCodeToTurn,
  rollbackContext,
  rollbackBothToTurn,
  undoLastCodeRollback,
  getRollbackState,
  forkSession,
} from '../lib/core-api';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
  RollbackPreviewDiff,
  SessionRollbackState,
} from '../lib/core-api';
import type { Item, Turn, Project } from '@shared/types';

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);
}

// Module-level abort controllers — shared across hooks (singleton pattern)
const abortControllers = new Map<string, AbortController>();

// ---- useAgentCore: sendMessage + abort + initialization ----

export function useAgentCore() {
  const startTurn = useGlobalStore((s) => s.startTurn);
  const applyChunk = useGlobalStore((s) => s.applyChunk);
  const updateTurnId = useGlobalStore((s) => s.updateTurnId);
  const completeTurn = useGlobalStore((s) => s.completeTurn);
  const setPendingInput = useGlobalStore((s) => s.setPendingInput);
  const clearRunningTurns = useGlobalStore((s) => s.clearRunningTurns);
  const applyTodoUpdate = useGlobalStore((s) => s.applyTodoUpdate);
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread);
  const loadThreads = useGlobalStore((s) => s.loadThreads);
  const setThreadTurns = useGlobalStore((s) => s.setThreadTurns);
  const setModel = useGlobalStore((s) => s.setModel);
  const setModels = useGlobalStore((s) => s.setModels);
  const setContextUsage = useGlobalStore((s) => s.setContextUsage);
  const setThreadUsage = useGlobalStore((s) => s.setThreadUsage);
  const workspace = useGlobalStore((s) => s.workspace);
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId);
  const approvalPolicy = useGlobalStore((s) => s.agent.approvalPolicy);

  // Load sessions, models, and projects on mount
  useEffect(() => {
    listModels()
      .then((data) => {
        if (data.models) setModels(data.models);
        if (data.activeId) setModel(data.activeId);
      })
      .catch((e) => {
        console.error('Failed to load models:', e);
      });

    const currentCwd = workspace.rootPath;
    if (currentCwd) {
      listSessions(currentCwd)
        .then((sessions) => {
          const threads = sessions.map((s: any) => ({
            id: s.sessionId,
            projectId: '',
            title: s.title ?? s.sessionId.slice(0, 8),
            cwd: normalizeCwd(s.cwd ?? ''),
            turns: [],
            createdAt: new Date(s.createdAt).getTime(),
            updatedAt: new Date(s.updatedAt).getTime(),
          }));
          loadThreads(threads);
          for (const s of sessions) {
            if (s.usage) {
              setThreadUsage(s.sessionId, {
                prompt: s.usage.prompt,
                completion: s.usage.completion,
                total: s.usage.total,
              });
            }
          }
        })
        .catch((e) => {
          console.error('Failed to load sessions:', e);
        });
    }
  }, [loadThreads, setModel, setModels, setThreadUsage, workspace.rootPath]);

  // Load history from HTTP when switching to a thread with no turns
  useEffect(() => {
    if (!currentThreadId) return;
    const thread = useGlobalStore.getState().agent.threads[currentThreadId];
    if (!thread || thread.turns.length > 0) return;
    getSessionHistory(currentThreadId)
      .then((turns) => {
        if (turns && turns.length > 0) {
          setThreadTurns(currentThreadId, turns as any);
        }
      })
      .catch((e) => {
        console.error('Failed to load history:', e);
      });
  }, [currentThreadId, setThreadTurns]);

  const streamChunkToItem = useCallback(
    (
      event: StreamChunk,
      threadId: string,
      assistantMessageId: string,
      currentTurnId: string
    ): Item | null => {
      switch (event.type) {
        case 'text':
          return {
            id: assistantMessageId,
            type: 'message',
            role: 'assistant',
            content: event.text,
            partial: true,
          };
        case 'message':
          return {
            id: assistantMessageId,
            type: 'message',
            role: 'assistant',
            content: event.content,
            partial: false,
          };
        case 'turn_id':
          updateTurnId(threadId, currentTurnId, String(event.turnId));
          return null;
        case 'tool_start':
          return {
            id: event.id,
            type: 'tool_call',
            name: event.name,
            args: event.args,
            status: 'running',
          };
        case 'approval_request':
          return {
            id: event.id,
            type: 'tool_call',
            name: event.tool,
            args: event.args,
            status: 'pending',
          };
        case 'tool_result':
          return {
            id: randomId(),
            type: 'tool_result',
            callId: event.id,
            name: event.name,
            output: event.output,
            exitCode: event.ok ? 0 : 1,
          };
        case 'tool_denied':
          return {
            id: event.id,
            type: 'tool_call',
            name: event.name,
            args: {},
            status: 'rejected',
          };
        case 'error':
          return { id: randomId(), type: 'error', message: event.message, code: event.code };
        case 'todo_update':
          applyTodoUpdate(threadId, event.items as any);
          return null;
        case 'usage': {
          setThreadUsage(threadId, {
            prompt: event.prompt,
            completion: event.completion,
            total: event.total,
          });
          const state = useGlobalStore.getState();
          const model = state.agent.models.find((m) => m.id === state.agent.model);
          if (model) {
            setContextUsage({ used: event.prompt, contextWindow: model.context_window });
          }
          return null;
        }
        case 'reactive_compact':
          {
            const contextUsage = useGlobalStore.getState().agent.contextUsage;
            if (contextUsage) {
              setContextUsage({
                used: event.promptEstimate,
                contextWindow: contextUsage.contextWindow,
              });
            }
          }
          return null;
        case 'done':
        case 'session_id':
          return null;
        default:
          return null;
      }
    },
    [applyTodoUpdate, updateTurnId, setThreadUsage, setContextUsage]
  );

  const sendMessage = useCallback(
    async (content: string, cwd?: string) => {
      const effectiveCwd = cwd || workspace.rootPath || '';

      let threadId = currentThreadId;
      if (!threadId) {
        const POLICY_TO_MODE: Record<string, string> = {
          'ask-all': 'default',
          'smart-allow': 'acceptEdits',
          'full-allow': 'bypass',
          'read-only': 'plan',
        };
        const initialMode = POLICY_TO_MODE[approvalPolicy] ?? 'default';
        const data = await createServerSession(effectiveCwd, initialMode);
        threadId = data.sessionId;
        setCurrentThread(threadId);
      }

      if (abortControllers.has(threadId)) return;

      let turnId = randomId();
      let assistantMessageId = randomId();
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content };
      const turn: Turn = { id: turnId, items: [userItem], status: 'running' };

      startTurn(threadId, turn, { cwd: effectiveCwd, title: content.slice(0, 60) });

      const controller = new AbortController();
      abortControllers.set(threadId, controller);

      try {
        const stream = agentClient.sendMessage(content, {
          sessionId: threadId,
          cwd: effectiveCwd,
          signal: controller.signal,
        });

        let hasError = false;
        for await (const event of stream) {
          if (event.type === 'session_id') continue;

          if (event.type === 'error') {
            hasError = true;
          }

          const item = streamChunkToItem(event, threadId, assistantMessageId, turnId);
          if (item) {
            applyChunk(threadId, turnId, item);
          }

          if (event.type === 'turn_id') {
            turnId = String(event.turnId);
          }

          if (event.type === 'tool_start' || event.type === 'approval_request') {
            assistantMessageId = randomId();
          }
        }

        completeTurn(threadId, turnId, hasError ? 'error' : 'completed');
      } catch (err: any) {
        const msg = err instanceof ApiError ? (err.body?.message ?? err.message) : String(err);
        applyChunk(threadId, turnId, { id: randomId(), type: 'error', message: msg });
        completeTurn(threadId, turnId, 'error');
      } finally {
        abortControllers.delete(threadId);
      }
    },
    [
      startTurn,
      setCurrentThread,
      streamChunkToItem,
      applyChunk,
      completeTurn,
      workspace.rootPath,
      approvalPolicy,
      currentThreadId,
    ]
  );

  const abort = useCallback(() => {
    const threadId = currentThreadId;
    if (!threadId) return;
    const controller = abortControllers.get(threadId);
    if (controller) {
      controller.abort();
      abortControllers.delete(threadId);
    }
  }, [currentThreadId]);

  return { sendMessage, abort };
}

// ---- useAgentApproval: approveTool + rejectTool ----

export function useAgentApproval() {
  const updateToolCallStatus = useGlobalStore((s) => s.updateToolCallStatus);

  const approveTool = useCallback(
    async (threadId: string, callId: string) => {
      updateToolCallStatus(threadId, callId, 'running');
      try {
        await sendApprovalResponse(threadId, callId, 'allow');
      } catch (e) {
        console.error('Failed to approve tool:', e);
      }
    },
    [updateToolCallStatus]
  );

  const rejectTool = useCallback(
    async (threadId: string, callId: string) => {
      updateToolCallStatus(threadId, callId, 'rejected');
      try {
        await sendApprovalResponse(threadId, callId, 'deny');
      } catch (e) {
        console.error('Failed to reject tool:', e);
      }
    },
    [updateToolCallStatus]
  );

  return { approveTool, rejectTool };
}

// ---- useAgentRollback: all rollback methods ----

export function useAgentRollback() {
  const workspace = useGlobalStore((s) => s.workspace);
  const setPendingInput = useGlobalStore((s) => s.setPendingInput);
  const clearRunningTurns = useGlobalStore((s) => s.clearRunningTurns);
  const setThreadTurns = useGlobalStore((s) => s.setThreadTurns);
  const setContextUsage = useGlobalStore((s) => s.setContextUsage);
  const loadThreads = useGlobalStore((s) => s.loadThreads);
  const setThreadUsage = useGlobalStore((s) => s.setThreadUsage);
  // Rollback store
  const revertedFilesByTurnId = useGlobalStore((s) => s.rollback.revertedFilesByTurnId);
  const setRollbackState = useGlobalStore((s) => s.setRollbackState);
  const setCheckpointDiff = useGlobalStore((s) => s.setCheckpointDiff);
  const setRollbackPreview = useGlobalStore((s) => s.setRollbackPreview);
  const markFileReverted = useGlobalStore((s) => s.markFileReverted);
  const markFileRestored = useGlobalStore((s) => s.markFileRestored);
  const markScopeReverted = useGlobalStore((s) => s.markScopeReverted);
  const setTurnCheckpointMapping = useGlobalStore((s) => s.setTurnCheckpointMapping);
  const initRevertedFilesFromState = useGlobalStore((s) => s.initRevertedFilesFromState);

  const resolveUITurnId = useCallback((threadId: string, checkpointId: number): string => {
    const mapping = useGlobalStore.getState().rollback.turnCheckpointMapping;
    const uiId = mapping[threadId]?.[checkpointId];
    if (uiId) return uiId;
    return String(checkpointId);
  }, []);

  const loadCheckpointDiff = useCallback(
    async (threadId: string, turnId?: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const parsed = turnId != null ? parseInt(turnId, 10) : undefined;
      const numericTurnId = parsed != null && !isNaN(parsed) ? parsed : undefined;
      const diff = await getCheckpointDiff(threadId, cwd, numericTurnId);
      setCheckpointDiff(threadId, String(diff.turnId), diff);
      if (diff.turnId > 0 && numericTurnId == null) {
        const thread = useGlobalStore.getState().agent.threads[threadId];
        if (thread) {
          const completed = thread.turns.filter((t) => t.status === 'completed');
          const last = completed[completed.length - 1];
          if (last && last.id !== String(diff.turnId)) {
            setTurnCheckpointMapping(threadId, diff.turnId, last.id);
          }
        }
      }
      return diff;
    },
    [workspace.rootPath, setCheckpointDiff, setTurnCheckpointMapping]
  );

  const revertFile = useCallback(
    async (threadId: string, file: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await revertCheckpointFile(threadId, cwd, file);
      if (result.reverted) {
        markFileReverted(threadId, resolveUITurnId(threadId, result.throughTurnId), file);
      }
      return result;
    },
    [workspace.rootPath, markFileReverted, resolveUITurnId]
  );

  const revertFiles = useCallback(
    async (threadId: string, files: string[]) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await revertCheckpointFiles(threadId, cwd, files);
      if (result.reverted) {
        const uiId = resolveUITurnId(threadId, result.throughTurnId);
        for (const f of result.selectedFiles) {
          markFileReverted(threadId, uiId, f);
        }
      }
      return result;
    },
    [workspace.rootPath, markFileReverted, resolveUITurnId]
  );

  const revertAgentFiles = useCallback(
    async (threadId: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await revertCheckpointAgentFiles(threadId, cwd);
      if (result.reverted) {
        markScopeReverted(threadId, resolveUITurnId(threadId, result.throughTurnId), 'agent');
      }
      return result;
    },
    [workspace.rootPath, markScopeReverted, resolveUITurnId]
  );

  const revertAllFiles = useCallback(
    async (threadId: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await revertCheckpointAllFiles(threadId, cwd);
      if (result.reverted) {
        markScopeReverted(threadId, resolveUITurnId(threadId, result.throughTurnId), 'all');
      }
      return result;
    },
    [workspace.rootPath, markScopeReverted, resolveUITurnId]
  );

  const previewRollback = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const preview = await previewRollbackDiff(threadId, cwd, throughTurnId);
      setRollbackPreview(threadId, preview);
      return preview;
    },
    [workspace.rootPath, setRollbackPreview]
  );

  const rollbackCode = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await rollbackCodeToTurn(threadId, cwd, throughTurnId);
      return result;
    },
    [workspace.rootPath]
  );

  const rollbackCtx = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await rollbackContext(threadId, cwd, throughTurnId);
      clearRunningTurns(threadId);
      setThreadTurns(threadId, res.turns as Turn[]);
      if (res.rolledBackMessage) {
        setPendingInput(res.rolledBackMessage);
      }
      if (res.promptEstimate != null) {
        const state = useGlobalStore.getState();
        const entry = state.agent.models.find((m) => m.id === state.agent.model);
        const contextWindow = entry?.context_window ?? 0;
        if (contextWindow > 0) {
          setContextUsage({ used: res.promptEstimate, contextWindow });
        }
      }
      return res;
    },
    [workspace.rootPath, setThreadTurns, clearRunningTurns, setPendingInput, setContextUsage]
  );

  const rollbackBoth = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await rollbackBothToTurn(threadId, cwd, throughTurnId);
      setThreadTurns(threadId, res.turns as Turn[]);
      if (res.rolledBackMessage) {
        setPendingInput(res.rolledBackMessage);
      }
      if (res.promptEstimate != null) {
        const state = useGlobalStore.getState();
        const entry = state.agent.models.find((m) => m.id === state.agent.model);
        const contextWindow = entry?.context_window ?? 0;
        if (contextWindow > 0) {
          setContextUsage({ used: res.promptEstimate, contextWindow });
        }
      }
      return res;
    },
    [workspace.rootPath, setThreadTurns, setPendingInput, setContextUsage]
  );

  const undoCodeRollback = useCallback(
    async (threadId: string, uiTurnId: string, force?: boolean, files?: string[]) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await undoLastCodeRollback(threadId, cwd, force, files);
      if (result.restored) {
        for (const f of result.restoredFiles) {
          markFileRestored(threadId, uiTurnId, f);
        }
      }
      return result;
    },
    [workspace.rootPath, markFileRestored]
  );

  const forkThread = useCallback(
    async (threadId: string, atUuid?: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await forkSession(threadId, cwd, atUuid);
      return res.sessionId;
    },
    [workspace.rootPath]
  );

  const initRollbackState = useCallback(
    async (threadId: string) => {
      const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath;
      try {
        const state = await getRollbackState(threadId, cwd);
        setRollbackState(threadId, state);
        initRevertedFilesFromState(threadId);
      } catch {
        /* ignore */
      }
    },
    [workspace.rootPath, setRollbackState, initRevertedFilesFromState]
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteSession(threadId);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
      const currentCwd = useGlobalStore.getState().workspace.rootPath;
      if (currentCwd) {
        const sessions = await listSessions(currentCwd).catch(() => []);
        if (sessions) {
          const threads = sessions.map((s: any) => ({
            id: s.sessionId,
            projectId: '',
            title: s.title ?? s.sessionId.slice(0, 8),
            cwd: normalizeCwd(s.cwd ?? ''),
            turns: [],
            createdAt: new Date(s.createdAt).getTime(),
            updatedAt: new Date(s.updatedAt).getTime(),
          }));
          loadThreads(threads);
          for (const s of sessions) {
            if (s.usage) {
              setThreadUsage(s.sessionId, {
                prompt: s.usage.prompt,
                completion: s.usage.completion,
                total: s.usage.total,
              });
            }
          }
        }
      }
    },
    [loadThreads, setThreadUsage]
  );

  return {
    loadCheckpointDiff,
    revertFile,
    revertFiles,
    revertAgentFiles,
    revertAllFiles,
    previewRollback,
    rollbackCode,
    rollbackCtx,
    rollbackBoth,
    undoCodeRollback,
    forkThread,
    initRollbackState,
    deleteThread,
    revertedFilesByTurnId,
  };
}

// ---- Legacy useAgent: combines all three hooks for backward compatibility ----

export function useAgent() {
  const core = useAgentCore();
  const approval = useAgentApproval();
  const rollback = useAgentRollback();
  return { ...core, ...approval, ...rollback };
}
