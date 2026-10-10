import { useEffect, useCallback, useRef } from 'react';
import { useAgentStore, type ModelEntry, type QueuedInput } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useRollbackStore } from '../stores/rollback.store';
import { agentClient } from '../lib/core-api';
import { createStreamState, reduceFrame, type StreamEffects } from '../lib/frame-reducer';
import type { PermissionMode, ProfileName } from '@codingcode/sdk';
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
  getAgentConfig as fetchAgentConfig,
} from '../lib/core-api';
import type {
  CodeRollbackResult,
} from '../lib/core-api';
import type { Item, Turn, Project } from '@shared/types';
import type { ContentPart } from '@shared/parts';
import { textOf, toWireParts } from '@shared/parts';

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

// ---- useAgentCore: sendMessage + abort + initialization ----

export function useAgentCore() {
  const lastRootRef = useRef<string | null>(null);
  /** 回合结束后自动补发的稳定入口（在 flushQueued 定义后赋值） */
  const sendQueuedInputRef = useRef<((threadId: string) => Promise<void>) | null>(null);
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
  const setActiveModel = useAgentStore((s) => s.setActiveModel);
  const setModels = useAgentStore((s) => s.setModels);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const setThreadUsage = useAgentStore((s) => s.setThreadUsage);
  const workspace = useWorkspaceStore();
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const storeProfile = useAgentStore((s) => s.profile);
  const storePermissionMode = useAgentStore((s) => s.permissionMode);
  const setProfile = useAgentStore((s) => s.setProfile);
  const setPermissionMode = useAgentStore((s) => s.setPermissionMode);
  const modelId = useAgentStore((s) => s.model);
  const queueInput = useAgentStore((s) => s.queueInput);
  const removeQueuedInput = useAgentStore((s) => s.removeQueuedInput);
  const markQueueSending = useAgentStore((s) => s.markQueueSending);

  // Abort all in-flight streams when the workspace root changes (project switch).
  useEffect(() => {
    const lastRoot = lastRootRef.current;
    if (lastRoot !== null && lastRoot !== workspace.rootPath) {
      abortAndClearAll();
    }
    lastRootRef.current = workspace.rootPath;
  }, [workspace.rootPath]);

  useEffect(() => {
    fetchAgentConfig()
      .then((cfg) => {
        setProfile(cfg.activeProfile);
        setPermissionMode(cfg.permissionMode);
      })
      .catch((e) => {
        console.error('Failed to load agent config:', e);
      });
  }, [setProfile, setPermissionMode]);

  // Load sessions, models, and projects on mount
  useEffect(() => {
    listModels()
      .then((data) => {
        if (data.models) setModels(data.models);
        // 全局默认模型以服务端 config.yaml 为准；当前没有打开会话时才同步到当前模型
        if (data.activeId) {
          setActiveModel(data.activeId);
          if (!useAgentStore.getState().currentThreadId) setModel(data.activeId);
        }
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
            // 会话的模型来自服务端索引；索引被重建过会是 'unknown'，那种值当作没设置
            model: s.model && s.model !== 'unknown' ? s.model : '',
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
  }, [loadThreads, setModel, setActiveModel, setModels, setThreadUsage, workspace.rootPath]);

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

  /**
   * 建乐观 Turn + 消费帧流。sendMessage 与 sendQueuedInput 共用；
   * `preRegistered` 为 sendQueuedInput 已登记的 controller，避免重复登记。
   */
  const runTurnStream = useCallback(
    async (
      threadId: string,
      parts: ContentPart[],
      opts: {
        cwd: string;
        model: string;
        skills?: Array<{ name: string; path: string }>;
        preRegistered?: AbortController;
      }
    ) => {
      let activeTurnId = randomId();
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', parts };
      const turn: Turn = { id: activeTurnId, items: [userItem], status: 'running' };
      startTurn(threadId, turn, {
        cwd: opts.cwd,
        title: textOf(parts).slice(0, 60),
        model: opts.model,
      });

      const controller = opts.preRegistered ?? new AbortController();
      if (!opts.preRegistered) registerInflight(threadId, controller);

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
        onInputDelivered: (id) => removeQueuedInput(threadId, id),
      };

      let failed = false;
      try {
        const result = await agentClient.submitInput(toWireParts(parts), {
          sessionId: threadId,
          cwd: opts.cwd,
          model: opts.model,
          signal: controller.signal,
          skills: opts.skills,
        });
        if (result.kind === 'turn') {
          for await (const frame of result.stream) {
            reduceFrame(frame, state, fx);
          }
        }
      } catch (err: any) {
        failed = true;
        const msg = err instanceof ApiError ? (err.body?.message ?? err.message) : String(err);
        applyChunk(threadId, activeTurnId, { id: randomId(), type: 'error', message: msg });
      } finally {
        completeTurn(threadId, activeTurnId, failed || state.hasError ? 'error' : 'completed');
        if (!failed && !state.hasError && state.planTitle !== null) {
          setPendingPlan(threadId, { sessionId: threadId, title: state.planTitle });
        }
        abortAndClear(threadId);
        // 自动补发：回合结束后按顺序把仍处于 queued 的项逐条发出
        void sendQueuedInputRef.current?.(threadId);
      }
    },
    [
      startTurn,
      applyChunk,
      applyTodoUpdate,
      completeTurn,
      setPendingPlan,
      updateTurnId,
      setThreadUsage,
      setContextUsage,
      removeQueuedInput,
    ]
  );

  const sendMessage = useCallback(
    async (parts: ContentPart[], cwd?: string, skills?: Array<{ name: string; path: string }>) => {
      const effectiveCwd = cwd || workspace.rootPath || '';

      let resolvedThreadId = currentThreadId;
      let model = modelId;
      if (!resolvedThreadId) {
        const activeProfile: ProfileName = storeProfile;
        const permissionMode: PermissionMode =
          activeProfile === 'plan' ? 'askBeforeExec' : storePermissionMode;
        // 新会话用全局配置的模型：以服务端的 activeId 为准，顺带刷新模型列表
        try {
          const data = await listModels();
          if (data.models) setModels(data.models);
          if (data.activeId) {
            model = data.activeId;
            // 无会话时 setActiveModel 同时把当前模型对齐成全局默认
            setActiveModel(data.activeId);
          }
        } catch (e) {
          console.error('Failed to refresh models:', e);
        }
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
          model,
          optimistic: true,
        });
      }
      const threadId: string = resolvedThreadId;

      // 首次发送的防重：已有在飞流时直接忽略
      if (inflightControllers.has(threadId)) return;
      clearPendingPlan(threadId);

      await runTurnStream(threadId, parts, { cwd: effectiveCwd, model, skills });
    },
    [
      runTurnStream,
      setCurrentThreadWithProfile,
      clearPendingPlan,
      workspace.rootPath,
      storeProfile,
      storePermissionMode,
      modelId,
      currentThreadId,
      setActiveModel,
      setModels,
    ]
  );

  /**
   * 队列项投递：命中活跃回合 → 202，等运行中的 SSE 送来 user_input 帧；
   * 无活跃回合 → 开新回合（自动补发即走此分支）。
   */
  const sendQueuedInput = useCallback(
    async (threadId: string, item: QueuedInput) => {
      markQueueSending(threadId, item.id);
      const thread = useAgentStore.getState().threads[threadId];
      const effectiveCwd = thread?.cwd || workspace.rootPath || '';
      const model = thread?.model || modelId;
      const controller = new AbortController();
      let result;
      try {
        result = await agentClient.submitInput(toWireParts(item.parts), {
          sessionId: threadId,
          inputId: item.id,
          cwd: effectiveCwd,
          model,
          signal: controller.signal,
        });
      } catch (err) {
        // 提交失败：移除该项并提示
        removeQueuedInput(threadId, item.id);
        const msg = err instanceof ApiError ? (err.body?.message ?? err.message) : String(err);
        const running = useAgentStore
          .getState()
          .threads[threadId]?.turns.find((t) => t.status === 'running');
        if (running) applyChunk(threadId, running.id, { id: randomId(), type: 'error', message: msg });
        return;
      }
      if (result.kind === 'queued') return; // 等运行中的 SSE 送来 user_input 帧

      // 无活跃回合：开新回合；乐观 Turn 用 item.parts
      removeQueuedInput(threadId, item.id);
      if (inflightControllers.has(threadId)) return;
      clearPendingPlan(threadId);
      registerInflight(threadId, controller);
      await runTurnStream(threadId, item.parts, {
        cwd: effectiveCwd,
        model,
        skills: undefined,
        preRegistered: controller,
      });
    },
    [
      runTurnStream,
      markQueueSending,
      removeQueuedInput,
      applyChunk,
      clearPendingPlan,
      workspace.rootPath,
      modelId,
    ]
  );

  /** 回合结束后：按顺序补发仍 queued 的队列项（每项都是一次 sendQueuedInput） */
  const flushQueued = useCallback(
    async (threadId: string) => {
      const pending = (useAgentStore.getState().queuedInputsByThreadId[threadId] ?? []).filter(
        (q) => q.status === 'queued'
      );
      for (const item of pending) {
        const current = useAgentStore.getState().queuedInputsByThreadId[threadId] ?? [];
        if (!current.some((q) => q.id === item.id && q.status === 'queued')) continue;
        await sendQueuedInput(threadId, item);
      }
    },
    [sendQueuedInput]
  );

  // runTurnStream 的 finally 需要一个稳定引用，避免与 flushQueued 互相依赖
  sendQueuedInputRef.current = flushQueued;

  const abort = useCallback(() => {
    const threadId = currentThreadId;
    if (!threadId) return;
    abortAndClear(threadId);
  }, [currentThreadId]);

  return { sendMessage, sendQueuedInput, queueInput, abort };
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
        (i) => i.type === 'message' && i.role === 'user'
      );
      const userContent = userMsg && userMsg.type === 'message' ? textOf(userMsg.parts) : '';
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
        (i) => i.type === 'message' && i.role === 'user'
      );
      const userContent = userMsg && userMsg.type === 'message' ? textOf(userMsg.parts) : '';
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
