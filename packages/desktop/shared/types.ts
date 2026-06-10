export type ItemType = 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'error';

export type Item =
  | { id: string; type: 'message'; role: 'user' | 'assistant'; content: string; partial?: boolean }
  | { id: string; type: 'reasoning'; content: string; isVisible: boolean }
  | {
      id: string;
      type: 'tool_call';
      name: string;
      args: object;
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
  | { id: string; type: 'error'; message: string; code?: string };

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  step: string;
  status: TodoStatus;
}

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
