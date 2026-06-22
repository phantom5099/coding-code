import { useEffect, useCallback, useRef } from 'react';
import { useAgentStore, type ModelEntry } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useRollbackStore } from '../stores/rollback.store';
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
  revertCheckpointFiles,
  previewRollbackDiff,
  rollbackCodeToTurn,
  rollbackContext,
  rollbackBothToTurn,
  undoLastCodeRollback,
  getRollbackState,
  forkSession,
  getSessionMode,
  setSessionMode,
  getSessionPlan,
} from '../lib/core-api';
import type {
  CheckpointDiff,
  CodeRollbackResult,
  CodeRollbackUndoResult,
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
  const startTurn = useAgentStore((s) => s.startTurn);
  const applyChunk = useAgentStore((s) => s.applyChunk);
  const updateTurnId = useAgentStore((s) => s.updateTurnId);
  const completeTurn = useAgentStore((s) => s.completeTurn);
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const setPendingPlan = useAgentStore((s) => s.setPendingPlan);
  const clearRunningTurns = useAgentStore((s) => s.clearRunningTurns);
  const applyTodoUpdate = useAgentStore((s) => s.applyTodoUpdate);
  const setCurrentThread = useAgentStore((s) => s.setCurrentThread);
  const loadThreads = useAgentStore((s) => s.loadThreads);
  const setThreadTurns = useAgentStore((s) => s.setThreadTurns);
  const setModel = useAgentStore((s) => s.setModel);
  const setModels = useAgentStore((s) => s.setModels);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const setThreadUsage = useAgentStore((s) => s.setThreadUsage);
  const clearThreadUsage = useAgentStore((s) => s.clearThreadUsage);
  const workspace = useWorkspaceStore();
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const approvalPolicy = useAgentStore((s) => s.approvalPolicy);
  const pendingProfile = useAgentStore((s) => s.pendingProfile);

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
    const thread = useAgentStore.getState().threads[currentThreadId];
    if (!thread || thread.turns.length > 0) return;
    getSessionHistory(currentThreadId, thread.cwd)
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
            // Forward the server-side payload (e.g. plan_content for submit_plan)
            // so the UI can render a specialized approval modal without a second
            // round-trip to fetch the plan file.
            payload: event.payload,
          };
        case 'plan_ready':
          // The server's plan.ready SSE event drives the plan-approval
          // modal directly. We don't write a tool_call item — the modal
          // renders from this payload via useAgentStore's pendingPlan.
          return null;
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
          const agentState = useAgentStore.getState();
          const model = agentState.models.find((m) => m.id === agentState.model);
          if (model) {
            setContextUsage({ used: event.prompt, contextWindow: model.context_window });
          }
          return null;
        }
        case 'reactive_compact':
          {
            const contextUsage = useAgentStore.getState().contextUsage;
            if (contextUsage) {
              setContextUsage({
                used: event.promptEstimate,
                contextWindow: contextUsage.contextWindow,
              });
            }
            clearThreadUsage(threadId);
          }
          return null;
        case 'done':
        case 'session_id':
          return null;
        default:
          return null;
      }
    },
    [applyTodoUpdate, updateTurnId, setThreadUsage, setContextUsage, clearThreadUsage]
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
        // pendingProfile ('plan' | 'build') set on the welcome screen
        // overrides the permission-policy default when it asks for plan.
        const initialMode =
          pendingProfile === 'plan' ? 'plan' : (POLICY_TO_MODE[approvalPolicy] ?? 'default');
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

          if (event.type === 'plan_ready') {
            setPendingPlan(threadId, {
              sessionId: event.sessionId,
              title: event.title,
              path: event.path,
              content: event.content,
            });
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
      setPendingPlan,
      workspace.rootPath,
      approvalPolicy,
      pendingProfile,
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

// ---- useAgentApproval: approveTool + rejectTool + sendPlanDecision ----

export type PlanChoice =
  | { type: 'allow' }
  | { type: 'modified'; input: Record<string, unknown> }
  | { type: 'canceled' };

export function useAgentApproval() {
  const updateToolCallStatus = useAgentStore((s) => s.updateToolCallStatus);
  const setPendingPlan = useAgentStore((s) => s.setPendingPlan);

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

  /**
   * Apply the user's plan-mode decision by sending it as a new user
   * message. The async PlanApprovalService is gone; the LLM (or build
   * agent) picks up the chosen follow-up as the next turn. The pending
   * plan UI is closed locally so the chat resumes immediately.
   *
   * `sendMessage` is injected to avoid pulling the model/list init
   * effects of useAgentCore into this hook.
   */
  const sendPlanDecision = useCallback(
    async (
      threadId: string,
      _callId: string,
      message: string,
      sendMessage: (content: string, cwd?: string) => Promise<void>
    ) => {
      setPendingPlan(threadId, null);
      await sendMessage(message, threadId);
    },
    [setPendingPlan]
  );

  return { approveTool, rejectTool, sendPlanDecision };
}

// ---- useAgentRollback: all rollback methods ----

export function useAgentRollback() {
  const workspace = useWorkspaceStore();
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const clearRunningTurns = useAgentStore((s) => s.clearRunningTurns);
  const setThreadTurns = useAgentStore((s) => s.setThreadTurns);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const loadThreads = useAgentStore((s) => s.loadThreads);
  const setThreadUsage = useAgentStore((s) => s.setThreadUsage);
  // Rollback store
  const revertedFilesByTurnId = useRollbackStore((s) => s.revertedFilesByTurnId);
  const setRollbackState = useRollbackStore((s) => s.setRollbackState);
  const setCheckpointDiff = useRollbackStore((s) => s.setCheckpointDiff);
  const markFileReverted = useRollbackStore((s) => s.markFileReverted);
  const markFileRestored = useRollbackStore((s) => s.markFileRestored);
  const setTurnCheckpointMapping = useRollbackStore((s) => s.setTurnCheckpointMapping);
  const initRevertedFilesFromState = useRollbackStore((s) => s.initRevertedFilesFromState);

  const resolveUITurnId = useCallback((threadId: string, checkpointId: number): string => {
    const mapping = useRollbackStore.getState().turnCheckpointMapping;
    const uiId = mapping[threadId]?.[checkpointId];
    if (uiId) return uiId;
    return String(checkpointId);
  }, []);

  const loadCheckpointDiff = useCallback(
    async (threadId: string, turnId?: string) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const parsed = turnId != null ? parseInt(turnId, 10) : undefined;
      const numericTurnId = parsed != null && !isNaN(parsed) ? parsed : undefined;
      const diff = await getCheckpointDiff(threadId, cwd, numericTurnId);
      setCheckpointDiff(threadId, String(diff.turnId), diff);
      if (diff.turnId > 0 && numericTurnId == null) {
        const thread = useAgentStore.getState().threads[threadId];
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
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await revertCheckpointFiles(threadId, cwd, [file]);
      if (result.reverted) {
        markFileReverted(threadId, resolveUITurnId(threadId, result.throughTurnId), file);
      }
      return result;
    },
    [workspace.rootPath, markFileReverted, resolveUITurnId]
  );

  const revertFiles = useCallback(
    async (threadId: string, files: string[]) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
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

  const previewRollback = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const preview = await previewRollbackDiff(threadId, cwd, throughTurnId);
      return preview;
    },
    [workspace.rootPath]
  );

  const rollbackCode = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const { result } = await rollbackCodeToTurn(threadId, cwd, throughTurnId);
      return result;
    },
    [workspace.rootPath]
  );

  const rollbackCtx = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await rollbackContext(threadId, cwd, throughTurnId);
      clearRunningTurns(threadId);
      setThreadTurns(threadId, res.turns as Turn[]);
      setThreadUsage(threadId, res.usage ?? { prompt: 0, completion: 0, total: 0 });
      if (res.rolledBackMessage) {
        setPendingInput(res.rolledBackMessage);
      }
      if (res.promptEstimate != null) {
        const agentState = useAgentStore.getState();
        const entry = agentState.models.find((m) => m.id === agentState.model);
        const contextWindow = entry?.context_window ?? 0;
        if (contextWindow > 0) {
          setContextUsage({ used: res.promptEstimate, contextWindow });
        }
      }
      return res;
    },
    [
      workspace.rootPath,
      setThreadTurns,
      setThreadUsage,
      clearRunningTurns,
      setPendingInput,
      setContextUsage,
    ]
  );

  const rollbackBoth = useCallback(
    async (threadId: string, throughTurnId: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await rollbackBothToTurn(threadId, cwd, throughTurnId);
      setThreadTurns(threadId, res.turns as Turn[]);
      setThreadUsage(threadId, res.usage ?? { prompt: 0, completion: 0, total: 0 });
      if (res.rolledBackMessage) {
        setPendingInput(res.rolledBackMessage);
      }
      if (res.promptEstimate != null) {
        const agentState = useAgentStore.getState();
        const entry = agentState.models.find((m) => m.id === agentState.model);
        const contextWindow = entry?.context_window ?? 0;
        if (contextWindow > 0) {
          setContextUsage({ used: res.promptEstimate, contextWindow });
        }
      }
      return res;
    },
    [workspace.rootPath, setThreadTurns, setThreadUsage, setPendingInput, setContextUsage]
  );

  const undoCodeRollback = useCallback(
    async (threadId: string, uiTurnId: string, force?: boolean, files?: string[]) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
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
    async (threadId: string, atTurnId?: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await forkSession(threadId, cwd, atTurnId);
      return res.sessionId;
    },
    [workspace.rootPath]
  );

  const initRollbackState = useCallback(
    async (threadId: string) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
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
      const currentCwd = useWorkspaceStore.getState().rootPath;
      const wasCurrent = useAgentStore.getState().currentThreadId === threadId;
      try {
        await deleteSession(threadId, currentCwd);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
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
      if (wasCurrent) {
        useAgentStore.getState().setCurrentThread(null);
      }
    },
    [loadThreads, setThreadUsage]
  );

  return {
    loadCheckpointDiff,
    revertFile,
    revertFiles,
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

// ---- useAgentMode: plan/build mode switching + plan file access ----

export type SessionModeSnapshot = {
  profileName: string;
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypass';
  cwd: string;
  available: Array<{ name: string; description: string }>;
};

export type PlanFileSnapshot = {
  content: string;
  path: string;
  directory: string;
  exists: boolean;
};

/**
 * Hook for interacting with the plan/build mode of a single session, plus
 * reading the persisted plan file. Each call returns a fresh API to the
 * server — caching is done in the caller via useEffect / useState.
 */
export function useAgentMode() {
  const workspace = useWorkspaceStore();

  const fetchMode = useCallback(
    async (sessionId: string, cwd?: string): Promise<SessionModeSnapshot> => {
      return getSessionMode(sessionId, cwd ?? workspace.rootPath ?? '');
    },
    [workspace.rootPath]
  );

  const switchMode = useCallback(
    async (
      sessionId: string,
      profile: 'plan' | 'build',
      cwd?: string
    ): Promise<{ profileName: string; permissionMode: string }> => {
      return setSessionMode(sessionId, cwd ?? workspace.rootPath ?? '', profile);
    },
    [workspace.rootPath]
  );

  const fetchPlan = useCallback(
    async (sessionId: string, cwd?: string): Promise<PlanFileSnapshot> => {
      return getSessionPlan(sessionId, cwd ?? workspace.rootPath ?? '');
    },
    [workspace.rootPath]
  );

  return { fetchMode, switchMode, fetchPlan };
}
