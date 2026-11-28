import type { ContentPart } from './parts';
import type { TodoItem, TodoStatus } from '@codingcode/sdk';

export type { ContentPart } from './parts';
export type { TodoItem, TodoStatus };

export type ItemType =
  | 'message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'subagent'
  | 'ask_user';

export type Item =
  | { id: string; type: 'message'; role: 'user' | 'assistant'; parts: ContentPart[]; partial?: boolean }
  | { id: string; type: 'reasoning'; content: string; isVisible: boolean; partial?: boolean }
  | {
      id: string;
      type: 'tool_call';
      name: string;
      arguments: object;
      status: 'pending' | 'approved' | 'rejected' | 'running';
    }
  | {
      id: string;
      type: 'tool_result';
      callId: string;
      name?: string;
      output: string;
      exitCode?: number;
      filePath?: string;
      diff?: string;
      insertions?: number;
      deletions?: number;
    }
  | { id: string; type: 'error'; message: string; code?: string }
  | {
      id: string;
      type: 'subagent';
      sessionId: string;
      agentName: string;
      status: 'running' | 'completed' | 'failed';
    }
  | {
      id: string;
      type: 'ask_user';
      callId: string;
      question: string;
      questiontype: 'single' | 'multiple' | 'text';
      options: string[];
      status: 'waiting' | 'answered';
    };

export interface TodoUpdateChunk {
  type: 'todo_update';
  items: TodoItem[];
}

export interface Turn {
  id: string;
  items: Item[];
  status: 'running' | 'completed' | 'error';
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  cwd: string;
  model?: string;
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  staged: string[];
  unstaged: string[];
}

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  icon?: string;
}

export interface OpenFile {
  path: string;
  isDirty: boolean;
}
