import { Effect } from 'effect';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { AgentError } from './error.js';
import { encodeProjectPath } from './path.js';
import { loadConfig, type AppConfig } from '@codingcode/infra/config';

export interface WorkspaceInit {
  processRoot?: string;
  workspaceCwd?: string;
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
    if (arg!.startsWith('--cwd=')) {
      workspaceCwd = arg!.slice('--cwd='.length);
      if (!workspaceCwd) throw new AgentError('CONFIG_INVALID', '--cwd requires a directory path');
      continue;
    }
    args.push(arg!);
  }
  return { workspaceCwd, args };
}

export class WorkspaceService extends Effect.Service<WorkspaceService>()('Workspace', {
  sync: () => {
    let processRoot = process.cwd();
    let workspaceCwd = process.cwd();

    return {
      init(opts: WorkspaceInit = {}): void {
        processRoot = resolve(opts.processRoot ?? process.cwd());
        const raw = opts.workspaceCwd ?? processRoot;
        workspaceCwd = resolve(raw);
        if (!existsSync(workspaceCwd)) {
          throw new AgentError(
            'CONFIG_INVALID',
            `Workspace directory does not exist: ${workspaceCwd}`
          );
        }
        if (!statSync(workspaceCwd).isDirectory()) {
          throw new AgentError(
            'CONFIG_INVALID',
            `Workspace path is not a directory: ${workspaceCwd}`
          );
        }
      },

      getProcessRoot(): string {
        return processRoot;
      },

      getWorkspaceCwd(): string {
        return workspaceCwd;
      },

      resolveWorkspaceCwd(override?: string): string {
        if (override) return resolve(override);
        return workspaceCwd;
      },

      getWorkspacePath(): string {
        return encodeProjectPath(workspaceCwd);
      },

      resolveInWorkspace(path: string): string {
        return resolve(workspaceCwd, path);
      },

      getConfig(): AppConfig {
        return loadConfig();
      },
    };
  },
}) {}
