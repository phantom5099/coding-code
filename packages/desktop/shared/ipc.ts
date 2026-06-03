import type { FileNode, GitStatus } from '../shared/types';

export interface IpcChannels {
  ping: () => Promise<string>;
  'fs:readFile': (rootPath: string, path: string) => Promise<string>;
  'fs:writeFile': (rootPath: string, path: string, content: string) => Promise<void>;
  'fs:readDir': (rootPath: string, dir: string) => Promise<FileNode[]>;
  'fs:watch': (rootPath: string, dir: string) => Promise<string>;
  'fs:unwatch': (watchId: string) => Promise<void>;
  'fs:index': (rootPath: string, query: string) => Promise<FileNode[]>;
  'pty:create': (cwd: string, id: string, shell?: string) => Promise<void>;
  'pty:write': (id: string, data: string) => Promise<void>;
  'pty:resize': (id: string, cols: number, rows: number) => Promise<void>;
  'pty:kill': (id: string) => Promise<void>;
  'git:status': (cwd: string) => Promise<GitStatus>;
  'git:branches': (cwd: string) => Promise<string[]>;
  'git:switchBranch': (cwd: string, branch: string) => Promise<void>;
}

export interface IpcEvents {
  'fs:change': (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void;
  'pty:data': (payload: { id: string; data: string }) => void;
  'git:statusUpdate': (status: GitStatus) => void;
}
