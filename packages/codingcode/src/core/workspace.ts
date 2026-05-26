import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { AgentError } from './error.js';
import { encodeProjectPath } from './path.js';
import { type AppConfig, DEFAULT_CONFIG } from '@codingcode/infra';

let installRoot = process.cwd();
let workspaceCwd = process.cwd();
let _config: AppConfig = DEFAULT_CONFIG;

export interface WorkspaceInit {
  /** Directory where config/models.json lives (default: cwd at process start). */
  installRoot?: string;
  /** Agent working directory (default: installRoot). Set via --cwd. */
  workspaceCwd?: string;
  /** Pre-loaded app config. Hosts must load config before calling initWorkspace. */
  config?: AppConfig;
}

/** Parse `--cwd <path>` / `--cwd=<path>` from CLI args; returns remaining flags. */
export function parseWorkspaceArgs(argv: string[]): { workspaceCwd?: string; args: string[] } {
  const args: string[] = [];
  let workspaceCwd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cwd') {
      const next = argv[++i];
      if (!next) throw new AgentError('CONFIG_INVALID', '--cwd requires a directory path');
      workspaceCwd = next;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      workspaceCwd = arg.slice('--cwd='.length);
      if (!workspaceCwd) throw new AgentError('CONFIG_INVALID', '--cwd requires a directory path');
      continue;
    }
    args.push(arg);
  }
  return { workspaceCwd, args };
}

export function initWorkspace(opts: WorkspaceInit = {}): void {
  installRoot = resolve(opts.installRoot ?? process.cwd());
  const raw = opts.workspaceCwd ?? installRoot;
  workspaceCwd = resolve(raw);
  if (!existsSync(workspaceCwd)) {
    throw new AgentError('CONFIG_INVALID', `Workspace directory does not exist: ${workspaceCwd}`);
  }
  if (!statSync(workspaceCwd).isDirectory()) {
    throw new AgentError('CONFIG_INVALID', `Workspace path is not a directory: ${workspaceCwd}`);
  }
  if (opts.config) _config = opts.config;
}

/** Config / models.json root (where `npm start` was run). */
export function getInstallRoot(): string {
  return installRoot;
}

/** Agent working directory for tools, sessions, checkpoints, AGENTS.md. */
export function getWorkspaceCwd(): string {
  return workspaceCwd;
}

/** Resolved cwd for an API call; explicit body/query wins over configured workspace. */
export function resolveWorkspaceCwd(override?: string): string {
  if (override) return resolve(override);
  return workspaceCwd;
}

export function getWorkspacePath(): string {
  return encodeProjectPath(workspaceCwd);
}

/** Resolve a path relative to the configured workspace (absolute paths unchanged). */
export function resolveInWorkspace(path: string): string {
  return resolve(workspaceCwd, path);
}

export function getConfig(): AppConfig {
  return _config;
}
