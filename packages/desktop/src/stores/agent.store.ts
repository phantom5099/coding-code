import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Thread, Turn, Item, TodoItem } from '@shared/types';
import type { ContentPart } from '@shared/parts';
import { textOf } from '@shared/parts';
import type { Automation, PermissionMode, ProfileName } from '@codingcode/sdk';
import { buildToolDiff } from '../lib/diff-compute';
import { normalizeCwd } from './storage';
import { useRollbackStore } from './rollback.store';

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  context_window: number;
  /** 输入侧能力位，缺省视为不支持 */
  capabilities?: { vision: boolean; audio: boolean };
}

/** partial assistant 帧是纯文本增量：并到最后一个文本块上，没有就新起一块。 */
function appendText(parts: ContentPart[], text: string): void {
  const last = parts[parts.length - 1];
  if (last && last.type === 'text') last.text += text;
  else parts.push({ type: 'text', text });
}

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);
}

interface TodoPanelState {
  items: TodoItem[];
  hasSeenNonEmptyTodo: boolean;
  collapsed: boolean;
}

export interface PendingPlan {
  sessionId: string;
  title: string;
}

export interface QueuedInput {
  id: string;
  /** 本地形态：本地媒体带 dataUrl，提交时才转线上形状 */
  parts: ContentPart[];
  status: 'queued' | 'sending';
}

export interface StoredProfile {
  activeProfile: ProfileName;
  permissionMode: PermissionMode;
  fetchedAt: number;
  optimistic: boolean;
}

interface AgentState {
  currentThreadId: string | null;
  threads: Record<string, Thread>;
  profile: ProfileName;
  permissionMode: PermissionMode;
  model: string;
  activeModel: string;
  models: ModelEntry[];
  contextUsage: { used: number; contextWindow: number } | null;
  todoByThreadId: Record<string, TodoPanelState>;
  pendingInput: string | null;
  pendingPlanByThreadId: Record<string, PendingPlan | null>;
  queuedInputsByThreadId: Record<string, QueuedInput[]>;
  usageByThreadId: Record<string, { prompt: number; completion: number; total: number }>;
  profileByThreadId: Record<string, StoredProfile>;
  isCompressing: boolean;
  automations: Automation[];
}

interface AgentActions {
  setCurrentThread: (id: string | null) => void;
  setCurrentThreadWithProfile: (
    id: string,
    info: {
      activeProfile: ProfileName;
      permissionMode: PermissionMode;
      model?: string;
      optimistic?: boolean;
    }
  ) => void;
  setProfileForThread: (
    id: string,
    info: { activeProfile: ProfileName; permissionMode: PermissionMode; requestedAt?: number }
  ) => void;
  setOptimisticProfileForThread: (
    id: string,
    info: { activeProfile: ProfileName; permissionMode: PermissionMode }
  ) => void;
  removeThread: (id: string) => void;
  upsertThread: (thread: Thread) => void;
  setThreadTurns: (threadId: string, turns: Turn[]) => void;
  setThreadCwd: (threadId: string, cwd: string) => void;
  setProfile: (profile: ProfileName) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setModel: (model: string) => void;
  setActiveModel: (model: string) => void;
  selectModel: (model: string) => void;
  setModels: (models: ModelEntry[]) => void;
  setContextUsage: (usage: { used: number; contextWindow: number } | null) => void;
  setThreadUsage: (
    threadId: string,
    usage: { prompt: number; completion: number; total: number }
  ) => void;
  clearThreadUsage: (threadId: string) => void;
  loadThreads: (threads: Thread[]) => void;
  updateToolCallStatus: (
    threadId: string,
    callId: string,
    status: 'pending' | 'approved' | 'rejected' | 'running'
  ) => void;
  setPendingPlan: (threadId: string, plan: PendingPlan | null) => void;
  clearPendingPlan: (threadId: string) => void;
  startTurn: (
    threadId: string,
    turn: Turn,
    meta?: { cwd?: string; title?: string; model?: string }
  ) => void;
  applyChunk: (threadId: string, turnId: string, chunk: Item) => void;
  updateTurnId: (threadId: string, oldTurnId: string, newTurnId: string) => void;
  completeTurn: (threadId: string, turnId: string, status: 'completed' | 'error') => void;
  setPendingInput: (input: string | null) => void;
  queueInput: (threadId: string, parts: ContentPart[]) => void;
  removeQueuedInput: (threadId: string, id: string) => void;
  markQueueSending: (threadId: string, id: string) => void;
  reorderQueuedInputs: (threadId: string, from: number, to: number) => void;
  clearRunningTurns: (threadId: string) => void;
  applyTodoUpdate: (threadId: string, items: TodoItem[]) => void;
  toggleTodoCollapsed: (threadId: string) => void;
  setAutomations: (automations: Automation[]) => void;
  startCompressing: () => void;
  stopCompressing: () => void;
}

export const useAgentStore = create<AgentState & AgentActions>()(
  immer((set) => ({
      currentThreadId: null,
      threads: {},
      profile: 'build',
      permissionMode: 'askBeforeExec',
      model: '',
      activeModel: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
      pendingInput: null,
      pendingPlanByThreadId: {},
      queuedInputsByThreadId: {},
      usageByThreadId: {},
      profileByThreadId: {},
      isCompressing: false,
      automations: [],

      setCurrentThread: (id) =>
        set((s) => {
          s.currentThreadId = id;
          s.model = id ? s.threads[id]?.model || s.activeModel : s.activeModel;
          if (id) {
            const usage = s.usageByThreadId[id];
            const model = s.models.find((m) => m.id === s.model);
            if (usage && model) {
              s.contextUsage = { used: usage.total, contextWindow: model.context_window };
            } else {
              s.contextUsage = null;
            }
          } else {
            s.contextUsage = null;
          }
        }),

      setCurrentThreadWithProfile: (id, info) =>
        set((s) => {
          s.currentThreadId = id;
          s.profileByThreadId[id] = {
            activeProfile: info.activeProfile,
            permissionMode: info.permissionMode,
            fetchedAt: Date.now(),
            optimistic: info.optimistic ?? false,
          };
          s.model = info.model ?? s.threads[id]?.model ?? s.activeModel;
          if (id) {
            const usage = s.usageByThreadId[id];
            const model = s.models.find((m) => m.id === s.model);
            if (usage && model) {
              s.contextUsage = { used: usage.total, contextWindow: model.context_window };
            } else {
              s.contextUsage = null;
            }
          } else {
            s.contextUsage = null;
          }
        }),

      setProfileForThread: (id, info) =>
        set((s) => {
          const current = s.profileByThreadId[id];
          if (current && info.requestedAt !== undefined && current.fetchedAt > info.requestedAt) {
            return;
          }
          s.profileByThreadId[id] = {
            activeProfile: info.activeProfile,
            permissionMode: info.permissionMode,
            fetchedAt: Date.now(),
            optimistic: false,
          };
        }),

      setOptimisticProfileForThread: (id, info) =>
        set((s) => {
          const current = s.profileByThreadId[id];
          if (current && !current.optimistic) return;
          s.profileByThreadId[id] = {
            activeProfile: info.activeProfile,
            permissionMode: info.permissionMode,
            fetchedAt: 0,
            optimistic: true,
          };
        }),

      removeThread: (id) =>
        set((s) => {
          delete s.threads[id];
          delete s.usageByThreadId[id];
          delete s.todoByThreadId[id];
          delete s.pendingPlanByThreadId[id];
          delete s.profileByThreadId[id];
          delete s.queuedInputsByThreadId[id];
        }),

      upsertThread: (thread) =>
        set((s) => {
          s.threads[thread.id] = thread;
        }),

      setThreadTurns: (threadId, turns) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (thread) {
            s.threads[threadId] = { ...thread, turns };
          }
        }),

      setThreadCwd: (threadId, cwd) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (thread) thread.cwd = cwd;
        }),

      setProfile: (profile) =>
        set((s) => {
          s.profile = profile;
        }),

      setPermissionMode: (mode) =>
        set((s) => {
          s.permissionMode = mode;
        }),

      setModel: (model) =>
        set((s) => {
          s.model = model;
        }),

      setActiveModel: (model) =>
        set((s) => {
          s.activeModel = model;
          if (!s.currentThreadId) s.model = model;
        }),

      selectModel: (model) =>
        set((s) => {
          s.model = model;
          if (s.currentThreadId) {
            const thread = s.threads[s.currentThreadId];
            if (thread) thread.model = model;
          } else {
            s.activeModel = model;
          }
        }),

      setModels: (models) =>
        set((s) => {
          s.models = models;
        }),

      setContextUsage: (usage) =>
        set((s) => {
          s.contextUsage = usage;
        }),

      setThreadUsage: (threadId, usage) =>
        set((s) => {
          s.usageByThreadId[threadId] = usage;
        }),

      clearThreadUsage: (threadId) =>
        set((s) => {
          delete s.usageByThreadId[threadId];
        }),

      loadThreads: (threads) => {
        const incomingIds = new Set(threads.map((t) => t.id));
        set((s) => {
          const next: Record<string, Thread> = {};
          for (const t of threads) {
            const existing = s.threads[t.id];
            next[t.id] = existing ? { ...t, turns: existing.turns } : t;
          }
          for (const id of Object.keys(s.threads)) {
            const thread = s.threads[id] as Thread | undefined;
            if (!thread) continue;
            if (!incomingIds.has(id) && thread.turns.some((t) => t.status === 'running')) {
              next[id] = thread;
            }
          }
          s.threads = next;
          for (const id of Object.keys(s.usageByThreadId)) {
            if (!incomingIds.has(id)) {
              delete s.usageByThreadId[id];
            }
          }
          for (const id of Object.keys(s.todoByThreadId)) {
            if (!incomingIds.has(id)) {
              delete s.todoByThreadId[id];
            }
          }
          for (const id of Object.keys(s.profileByThreadId)) {
            if (!incomingIds.has(id)) {
              delete s.profileByThreadId[id];
            }
          }
          for (const id of Object.keys(s.queuedInputsByThreadId)) {
            if (!incomingIds.has(id)) {
              delete s.queuedInputsByThreadId[id];
            }
          }
        });
        useRollbackStore.getState().cleanupDeletedThreads(incomingIds);
      },

      updateToolCallStatus: (threadId, callId, status) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) return;
          for (const turn of thread.turns) {
            const idx = turn.items.findIndex((i) => i.id === callId && i.type === 'tool_call');
            if (idx >= 0) {
              const existing = turn.items[idx] as Item & { type: 'tool_call' };
              turn.items[idx] = { ...existing, status };
              break;
            }
          }
        }),

      startTurn: (threadId, turn, meta) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) {
            s.threads[threadId] = {
              id: threadId,
              projectId: '',
              title: meta?.title ?? 'New Conversation',
              cwd: meta?.cwd ? normalizeCwd(meta.cwd) : '',
              model: meta?.model ?? '',
              turns: [turn],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
          } else {
            thread.turns.push(turn);
            thread.updatedAt = Date.now();
          }
        }),

      applyChunk: (threadId, turnId, chunk) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === turnId);
          if (!turn) return;

          if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial) {
            const existing = turn.items.find((i) => i.id === chunk.id);
            if (existing && existing.type === 'message' && existing.role === 'assistant') {
              appendText(existing.parts, textOf(chunk.parts));
              existing.partial = true;
            } else {
              turn.items.push({ ...chunk, partial: true });
            }
            return;
          }

          if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial === false) {
            const existing = turn.items.findIndex((i) => i.id === chunk.id);
            if (existing >= 0) {
              const current = turn.items[existing];
              if (!current) return;
              if (current.type === 'message' && current.role === 'assistant') {
                turn.items[existing] = {
                  ...chunk,
                  parts: current.parts.length > 0 ? current.parts : chunk.parts,
                  partial: false,
                };
              } else {
                turn.items[existing] = { ...chunk, partial: false };
              }
            } else {
              turn.items.push({ ...chunk, partial: false });
            }
            return;
          }

          if (chunk.type === 'tool_call') {
            const existing = turn.items.findIndex((i) => i.id === chunk.id);
            if (existing >= 0) {
              const existingItem = turn.items[existing] as Item & { status?: string };
              if (existingItem.status === 'pending' && chunk.status === 'running') {
                return;
              }
              turn.items[existing] = chunk;
            } else {
              turn.items.push(chunk);
            }
            return;
          }

          if (chunk.type === 'tool_result') {
            let targetChunk = chunk;
            const callIdx = turn.items.findIndex(
              (i) => i.type === 'tool_call' && i.id === chunk.callId
            );
            if (callIdx >= 0) {
              const callItem = turn.items[callIdx] as any;
              callItem.status = 'approved';
              targetChunk = buildToolDiff(chunk, callItem) as any;
              turn.items.push(targetChunk);
              return;
            }
            for (const t of thread.turns) {
              if (t === turn) continue;
              const otherCallIdx = t.items.findIndex(
                (i) => i.type === 'tool_call' && i.id === chunk.callId
              );
              if (otherCallIdx >= 0) {
                const callItem = t.items[otherCallIdx] as any;
                callItem.status = 'approved';
                targetChunk = buildToolDiff(chunk, callItem) as any;
                t.items.push(targetChunk);
                return;
              }
            }
            turn.items.push(targetChunk);
            return;
          }

          const existing = turn.items.findIndex((i) => i.id === chunk.id);
          if (existing >= 0) {
            turn.items[existing] = chunk;
          } else {
            turn.items.push(chunk);
          }
        }),

      updateTurnId: (threadId, oldTurnId, newTurnId) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === oldTurnId);
          if (!turn) return;
          turn.id = newTurnId;
        }),

      completeTurn: (threadId, turnId, status) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === turnId);
          if (!turn) return;
          turn.status = status;
          thread.updatedAt = Date.now();
          for (const item of turn.items) {
            if (item.type === 'message' && item.role === 'assistant') {
              item.partial = false;
            }
          }
        }),

      setPendingInput: (input) =>
        set((s) => {
          s.pendingInput = input;
        }),

      queueInput: (threadId, parts) =>
        set((s) => {
          const list = s.queuedInputsByThreadId[threadId] ?? [];
          list.push({ id: randomId(), parts, status: 'queued' });
          s.queuedInputsByThreadId[threadId] = list;
        }),

      removeQueuedInput: (threadId, id) =>
        set((s) => {
          const list = s.queuedInputsByThreadId[threadId];
          if (!list) return;
          s.queuedInputsByThreadId[threadId] = list.filter((q) => q.id !== id);
        }),

      markQueueSending: (threadId, id) =>
        set((s) => {
          const item = s.queuedInputsByThreadId[threadId]?.find((q) => q.id === id);
          if (item) item.status = 'sending';
        }),

      reorderQueuedInputs: (threadId, from, to) =>
        set((s) => {
          const list = s.queuedInputsByThreadId[threadId];
          if (!list) return;
          if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
          const [moved] = list.splice(from, 1);
          if (moved) list.splice(to, 0, moved);
        }),

      setPendingPlan: (threadId, plan) =>
        set((s) => {
          if (plan === null) {
            delete s.pendingPlanByThreadId[threadId];
          } else {
            s.pendingPlanByThreadId[threadId] = plan;
          }
        }),

      clearPendingPlan: (threadId) =>
        set((s) => {
          delete s.pendingPlanByThreadId[threadId];
        }),

      clearRunningTurns: (threadId) =>
        set((s) => {
          const thread = s.threads[threadId];
          if (!thread) return;
          thread.turns = thread.turns.filter((t) => t.status !== 'running');
        }),

      applyTodoUpdate: (threadId, items) =>
        set((s) => {
          const previous = s.todoByThreadId[threadId];
          if (items.length > 0) {
            s.todoByThreadId[threadId] = {
              items,
              hasSeenNonEmptyTodo: true,
              collapsed: previous?.collapsed ?? false,
            };
            return;
          }
          if (previous?.hasSeenNonEmptyTodo) {
            s.todoByThreadId[threadId] = {
              ...previous,
              items: previous.items,
              hasSeenNonEmptyTodo: true,
            };
            return;
          }
          s.todoByThreadId[threadId] = {
            items: [],
            hasSeenNonEmptyTodo: false,
            collapsed: previous?.collapsed ?? false,
          };
        }),

      toggleTodoCollapsed: (threadId) =>
        set((s) => {
          const previous = s.todoByThreadId[threadId];
          if (!previous) return;
          previous.collapsed = !previous.collapsed;
        }),

      setAutomations: (automations) =>
        set((s) => {
          s.automations = automations;
        }),

      startCompressing: () =>
        set((s) => {
          s.isCompressing = true;
        }),

      stopCompressing: () =>
        set((s) => {
          s.isCompressing = false;
        }),
    }))
);
