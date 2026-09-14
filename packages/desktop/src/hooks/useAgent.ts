import { useEffect, useCallback, useRef } from 'react';
import { useAgentStore, type ModelEntry } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useRollbackStore } from '../stores/rollback.store';
import { agentClient } from '../lib/core-api';
import { createStreamState, reduceFrame, type StreamEffects } from '../lib/frame-reducer';
import type { ProfileName } from '@codingcode/core/contracts/types';
import type { PermissionMode } from '@codingcode/core/contracts/permission';
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
  forkSession,
  getSessionProfile,
  setSessionProfile,
  getSessionPlan,
} from '../lib/core-api';
import type {
  CheckpointDiff,
  CodeRollbackResult,
} from '../lib/core-api';
import type { Item, Turn, Project } from '@shared/types';

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);
}

const MAX_INFLIGHT_CONTROLLERS = 100;
const inflightControllers = new Map<string, AbortController>();

function abortAndClear(threadId: string): void {
  const c = inflightControllers.get(threadId);
  if (c) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
    inflightControllers.delete(threadId);
  }
}

function abortAndClearAll(): void {
  for (const c of inflightControllers.values()) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  }
  inflightControllers.clear();
}

function registerInflight(threadId: string, controller: AbortController): void {
  abortAndClear(threadId);
  inflightControllers.set(threadId, controller);
  while (inflightControllers.size > MAX_INFLIGHT_CONTROLLERS) {
    const oldestKey = inflightControllers.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = inflightControllers.get(oldestKey);
    inflightControllers.delete(oldestKey);
    try {
      oldest?.abort();
    } catch {
      /* ignore */
    }
  }
}

export const APPROVAL_POLICY_TO_PERMISSION_MODE: Record<
  'ask-all' | 'smart-allow' | 'full-allow' | 'read-only',
  PermissionMode
> = {
  'ask-all': 'default',
  'smart-allow': 'acceptEdits',
  'full-allow': 'bypass',
  'read-only': 'default',
};

// ---- useAgentCore: sendMessage + abort + initialization ----

export function useAgentCore() {
  const lastRootRef = useRef<string | null>(null);
  const startTurn = useAgentStore((s) => s.startTurn);
  const applyChunk = useAgentStore((s) => s.applyChunk);
  const updateTurnId = useAgentStore((s) => s.updateTurnId);
  const completeTurn = useAgentStore((s) => s.completeTurn);
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const setPendingPlan = useAgentStore((s) => s.setPendingPlan);
  const clearPendingPlan = useAgentStore((s) => s.clearPendingPlan);
  const clearRunningTurns = useAgentStore((s) => s.clearRunningTurns);
  const applyTodoUpdate = useAgentStore((s) => s.applyTodoUpdate);
  const setCurrentThread = useAgentStore((s) => s.setCurrentThread);
  const setCurrentThreadWithProfile = useAgentStore((s) => s.setCurrentThreadWithProfile);
  const loadThreads = useAgentStore((s) => s.loadThreads);
  const setThreadTurns = useAgentStore((s) => s.setThreadTurns);
  const setModel = useAgentStore((s) => s.setModel);
  const setModels = useAgentStore((s) => s.setModels);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const setThreadUsage = useAgentStore((s) => s.setThreadUsage);
  const workspace = useWorkspaceStore();
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const approvalPolicy = useAgentStore((s) => s.approvalPolicy);
  const pendingProfile = useAgentStore((s) => s.pendingProfile);
  const modelId = useAgentStore((s) => s.model);

  // Abort all in-flight streams when the workspace root changes (project switch).
  useEffect(() => {
    const lastRoot = lastRootRef.current;
    if (lastRoot !== null && lastRoot !== workspace.rootPath) {
      abortAndClearAll();
    }
    lastRootRef.current = workspace.rootPath;
  }, [workspace.rootPath]);

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

  const sendMessage = useCallback(
    async (content: string, cwd?: string) => {
      const effectiveCwd = cwd || workspace.rootPath || '';

      let resolvedThreadId = currentThreadId;
      if (!resolvedThreadId) {
        const activeProfile: ProfileName = pendingProfile;
        const permissionMode: PermissionMode =
          pendingProfile === 'plan'
            ? 'default'
            : (APPROVAL_POLICY_TO_PERMISSION_MODE[approvalPolicy] ?? 'default');
        const model = modelId;
        if (!model) {
          throw new Error('No model selected. Please select a model first.');
        }
        const data = await createServerSession(effectiveCwd, {
          activeProfile,
          permissionMode,
          model,
        });
        resolvedThreadId = data.sessionId;
        setCurrentThreadWithProfile(resolvedThreadId, {
          activeProfile,
          permissionMode,
          optimistic: true,
        });
      }
      const threadId: string = resolvedThreadId;

      if (inflightControllers.has(threadId)) return;
      clearPendingPlan(threadId);

      let activeTurnId = randomId();
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content };
      const turn: Turn = { id: activeTurnId, items: [userItem], status: 'running' };
      startTurn(threadId, turn, { cwd: effectiveCwd, title: content.slice(0, 60) });

      const controller = new AbortController();
      registerInflight(threadId, controller);

      const state = createStreamState(randomId());
      const fx: StreamEffects = {
        applyItem: (item) => applyChunk(threadId, activeTurnId, item),
        applyTodo: (items) => applyTodoUpdate(threadId, items),
        setUsage: (usage) => {
          setThreadUsage(threadId, usage);
          const s = useAgentStore.getState();
          const model = s.models.find((m) => m.id === s.model);
          if (model) setContextUsage({ used: usage.prompt, contextWindow: model.context_window });
        },
        setCompacted: () => {
          useAgentStore.getState().clearThreadUsage(threadId);
        },
        syncTurnId: (turnId) => {
          const next = String(turnId);
          updateTurnId(threadId, activeTurnId, next);
          activeTurnId = next;
        },
        newId: () => randomId(),
      };

      try {
        const stream = agentClient.sendMessage(content, {
          sessionId: threadId,
          cwd: effectiveCwd,
          signal: controller.signal,
        });

        for await (const frame of stream) {
          reduceFrame(frame, state, fx);
        }

        completeTurn(threadId, activeTurnId, state.hasError ? 'error' : 'completed');
        if (!state.hasError && state.planTitle !== null) {
          setPendingPlan(threadId, { sessionId: threadId, title: state.planTitle });
        }
      } catch (err: any) {
        const msg = err instanceof ApiError ? (err.body?.message ?? err.message) : String(err);
        applyChunk(threadId, activeTurnId, { id: randomId(), type: 'error', message: msg });
        completeTurn(threadId, activeTurnId, 'error');
      } finally {
        abortAndClear(threadId);
      }
    },
    [
      startTurn,
      setCurrentThreadWithProfile,
      applyChunk,
      applyTodoUpdate,
      completeTurn,
      setPendingPlan,
      clearPendingPlan,
      updateTurnId,
      setThreadUsage,
      setContextUsage,
      workspace.rootPath,
      approvalPolicy,
      pendingProfile,
      modelId,
      currentThreadId,
    ]
  );

  const abort = useCallback(() => {
    const threadId = currentThreadId;
    if (!threadId) return;
    abortAndClear(threadId);
  }, [currentThreadId]);

  return { sendMessage, abort };
}

// ---- useAgentApproval: approveTool + rejectTool ----

export function useAgentApproval() {
  const updateToolCallStatus = useAgentStore((s) => s.updateToolCallStatus);

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
  const workspace = useWorkspaceStore();
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const clearRunningTurns = useAgentStore((s) => s.clearRunningTurns);
  const setThreadTurns = useAgentStore((s) => s.setThreadTurns);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const loadThreads = useAgentStore((s) => s.loadThreads);
  const setThreadUsage = useAgentStore((s) => s.setThreadUsage);
  // Rollback store
  const revertedFilesByTurnId = useRollbackStore((s) => s.revertedFilesByTurnId);
  const setCheckpointDiff = useRollbackStore((s) => s.setCheckpointDiff);
  const markFileReverted = useRollbackStore((s) => s.markFileReverted);
  const setTurnCheckpointMapping = useRollbackStore((s) => s.setTurnCheckpointMapping);

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
      const targetTurn = useAgentStore.getState().threads[threadId]?.turns.find(
        (t) => t.id === String(throughTurnId)
      );
      const userMsg = targetTurn?.items.find(
        (i) => i.type === 'message' && (i as any).role === 'user'
      );
      const userContent = userMsg && 'content' in userMsg ? (userMsg as any).content : '';
      const res = await rollbackContext(threadId, cwd, throughTurnId);
      clearRunningTurns(threadId);
      setThreadTurns(threadId, res.turns as Turn[]);
      setThreadUsage(threadId, res.usage ?? { prompt: 0, completion: 0, total: 0 });
      if (userContent) {
        setPendingInput(userContent);
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
      const targetTurn = useAgentStore.getState().threads[threadId]?.turns.find(
        (t) => t.id === String(throughTurnId)
      );
      const userMsg = targetTurn?.items.find(
        (i) => i.type === 'message' && (i as any).role === 'user'
      );
      const userContent = userMsg && 'content' in userMsg ? (userMsg as any).content : '';
      const res = await rollbackBothToTurn(threadId, cwd, throughTurnId);
      setThreadTurns(threadId, res.turns as Turn[]);
      setThreadUsage(threadId, res.usage ?? { prompt: 0, completion: 0, total: 0 });
      if (userContent) {
        setPendingInput(userContent);
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

  const forkThread = useCallback(
    async (threadId: string, atTurnId?: number) => {
      const cwd = useAgentStore.getState().threads[threadId]?.cwd ?? workspace.rootPath;
      const res = await forkSession(threadId, cwd, atTurnId);
      return res.sessionId;
    },
    [workspace.rootPath]
  );

  const deleteThread = useCallback(async (threadId: string) => {
    abortAndClear(threadId);
    const currentCwd = useWorkspaceStore.getState().rootPath;
    const wasCurrent = useAgentStore.getState().currentThreadId === threadId;
    try {
      await deleteSession(threadId, currentCwd);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
    useAgentStore.getState().removeThread(threadId);
    if (wasCurrent) {
      useAgentStore.getState().setCurrentThread(null);
    }
  }, []);

  return {
    loadCheckpointDiff,
    revertFile,
    revertFiles,
    previewRollback,
    rollbackCode,
    rollbackCtx,
    rollbackBoth,
    forkThread,
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

// ---- useAgentProfile: plan/build profile switching + plan file access ----

export type SessionProfileSnapshot = {
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
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
 * Hook for interacting with the plan/build profile of a single session, plus
 * reading the persisted plan file. Each call returns a fresh API to the
 * server — caching is done in the caller via useEffect / useState.
 */
export function useAgentProfile() {
  const workspace = useWorkspaceStore();

  const fetchProfile = useCallback(
    async (sessionId: string, cwd?: string): Promise<SessionProfileSnapshot> => {
      return getSessionProfile(sessionId, cwd ?? workspace.rootPath ?? '');
    },
    [workspace.rootPath]
  );

  const switchProfile = useCallback(
    async (
      sessionId: string,
      activeProfile: ProfileName,
      cwd?: string
    ): Promise<{ activeProfile: ProfileName; permissionMode: PermissionMode }> => {
      return setSessionProfile(sessionId, cwd ?? workspace.rootPath ?? '', activeProfile);
    },
    [workspace.rootPath]
  );

  const fetchPlan = useCallback(
    async (sessionId: string, cwd?: string): Promise<PlanFileSnapshot> => {
      return getSessionPlan(sessionId, cwd ?? workspace.rootPath ?? '');
    },
    [workspace.rootPath]
  );

  return { fetchProfile, switchProfile, fetchPlan };
}
