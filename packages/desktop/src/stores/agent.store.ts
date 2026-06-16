import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Thread, Turn, Item, TodoItem } from '@shared/types';
import { buildToolDiff } from '../lib/diff-compute';
import { createDebouncedStorage, normalizeCwd } from './storage';
import { useRollbackStore } from './rollback.store';

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  context_window: number;
}

interface TodoPanelState {
  items: TodoItem[];
  hasSeenNonEmptyTodo: boolean;
  collapsed: boolean;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  cron: string;
  timezone: string;
  sandbox: 'readonly' | 'workspace-write';
  enabled: boolean;
  projectCwd: string;
  runOnce: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastSessionId: string | null;
}

interface AgentState {
  currentThreadId: string | null;
  threads: Record<string, Thread>;
  approvalPolicy: 'ask-all' | 'smart-allow' | 'full-allow' | 'read-only';
  model: string;
  models: ModelEntry[];
  contextUsage: { used: number; contextWindow: number } | null;
  todoByThreadId: Record<string, TodoPanelState>;
  pendingInput: string | null;
  usageByThreadId: Record<string, { prompt: number; completion: number; total: number }>;
  isCompressing: boolean;
  automations: Automation[];
}

interface AgentActions {
  setCurrentThread: (id: string | null) => void;
  upsertThread: (thread: Thread) => void;
  setThreadTurns: (threadId: string, turns: Turn[]) => void;
  setThreadCwd: (threadId: string, cwd: string) => void;
  setApprovalPolicy: (policy: AgentState['approvalPolicy']) => void;
  setModel: (model: string) => void;
  setModels: (models: ModelEntry[]) => void;
  setContextUsage: (usage: { used: number; contextWindow: number } | null) => void;
  setThreadUsage: (
    threadId: string,
    usage: { prompt: number; completion: number; total: number }
  ) => void;
  loadThreads: (threads: Thread[]) => void;
  updateToolCallStatus: (
    threadId: string,
    callId: string,
    status: 'pending' | 'approved' | 'rejected' | 'running'
  ) => void;
  startTurn: (threadId: string, turn: Turn, meta?: { cwd?: string; title?: string }) => void;
  applyChunk: (threadId: string, turnId: string, chunk: Item) => void;
  updateTurnId: (threadId: string, oldTurnId: string, newTurnId: string) => void;
  completeTurn: (threadId: string, turnId: string, status: 'completed' | 'error') => void;
  setPendingInput: (input: string | null) => void;
  clearRunningTurns: (threadId: string) => void;
  applyTodoUpdate: (threadId: string, items: TodoItem[]) => void;
  toggleTodoCollapsed: (threadId: string) => void;
  setAutomations: (automations: Automation[]) => void;
  startCompressing: () => void;
  stopCompressing: () => void;
}

export const useAgentStore = create<AgentState & AgentActions>()(
  persist(
    immer((set) => ({
      currentThreadId: null,
      threads: {},
      approvalPolicy: 'ask-all',
      model: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
      pendingInput: null,
      usageByThreadId: {},
      isCompressing: false,
      automations: [],

      setCurrentThread: (id) =>
        set((s) => {
          s.currentThreadId = id;
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

      setApprovalPolicy: (policy) =>
        set((s) => {
          s.approvalPolicy = policy;
        }),

      setModel: (model) =>
        set((s) => {
          s.model = model;
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

      loadThreads: (threads) => {
        const incomingIds = new Set(threads.map((t) => t.id));
        set((s) => {
          const next: Record<string, Thread> = {};
          for (const t of threads) {
            const existing = s.threads[t.id];
            next[t.id] = existing ? { ...t, turns: existing.turns } : t;
          }
          for (const [id, thread] of Object.entries(s.threads)) {
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
              existing.content += chunk.content;
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
                  content: current.content || chunk.content,
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
    })),
    {
      name: 'codingcode-agent-store',
      storage: createJSONStorage(() => createDebouncedStorage()),
      partialize: (state) => ({
        approvalPolicy: state.approvalPolicy,
        model: state.model,
      }),
      merge: (persisted, current) => {
        const p = persisted as any;
        const OLD_POLICY_MAP: Record<string, string> = {
          suggest: 'ask-all',
          'auto-edit': 'smart-allow',
          'full-auto': 'full-allow',
        };
        const rawPolicy = p?.approvalPolicy;
        const migratedPolicy = rawPolicy ? (OLD_POLICY_MAP[rawPolicy] ?? rawPolicy) : undefined;
        return {
          ...current,
          ...p,
          approvalPolicy: migratedPolicy ?? current.approvalPolicy,
          threads: {},
          todoByThreadId: {},
          contextUsage: null,
          usageByThreadId: {},
        };
      },
    }
  )
);
