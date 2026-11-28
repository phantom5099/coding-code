import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import type { ConfinedCommand, SandboxPolicy } from './types.js';

const execFileAsync = promisify(execFile);

function quoteProfilePath(path: string): string {
  return JSON.stringify(path);
}

function seatbeltProfile(policy: SandboxPolicy): string {
  const writable = [policy.workspaceRoot, ...policy.additionalWritableRoots]
    .map((root) => `(subpath ${quoteProfilePath(root)})`)
    .join(' ');
  const network = policy.network.mode === 'none' ? '(deny network*)' : '(allow network*)';
  return `(version 1)
(deny default)
(allow process*)
(allow file-read*)
(allow file-write* ${writable})
${network}`;
}

async function executable(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', [name]);
    return true;
  } catch {
    return false;
  }
}

export interface SandboxProvider {
  confine(
    argv: readonly string[],
    policy: SandboxPolicy
  ): Effect.Effect<ConfinedCommand, AgentError>;
}

export const localSandboxProvider: SandboxProvider = {
  confine: (argv, policy) => {
    if (policy.mode === 'danger-full-access' || policy.mode === 'unrestricted') {
      return Effect.succeed({ argv: [...argv], enforcement: 'disabled', runner: 'none' });
    }

    if (policy.network.mode === 'allowlist') {
      return Effect.fail(
        new AgentError(
          'SANDBOX_UNAVAILABLE',
          'The local process sandbox cannot enforce network host allowlists'
        )
      );
    }

    return Effect.tryPromise({
      try: async (): Promise<ConfinedCommand> => {
        if (process.platform === 'linux') {
          if (!(await executable('bwrap'))) {
            throw new AgentError(
              'SANDBOX_UNAVAILABLE',
              'bubblewrap is required for restricted command execution'
            );
          }
          const args = [
            'bwrap',
            '--die-with-parent',
            '--unshare-user-try',
            '--unshare-pid',
            ...(policy.network.mode === 'none' ? ['--unshare-net'] : []),
            '--dev',
            '/dev',
            '--proc',
            '/proc',
            '--tmpfs',
            '/tmp',
          ];
          for (const root of ['/usr', '/bin', '/lib', '/lib64', '/etc']) {
            try {
              await import('node:fs/promises').then(({ access }) => access(root));
              args.push('--ro-bind', root, root);
            } catch {
              // Optional platform paths are omitted.
            }
          }
          args.push('--bind', policy.workspaceRoot, policy.workspaceRoot, '--chdir', policy.workspaceRoot);
          for (const root of policy.additionalWritableRoots) args.push('--bind', root, root);
          return { argv: [...args, '--', ...argv], enforcement: 'full', runner: 'bwrap' };
        }

        if (process.platform === 'darwin') {
          if (!(await executable('sandbox-exec'))) {
            throw new AgentError(
              'SANDBOX_UNAVAILABLE',
              'sandbox-exec is required for restricted command execution'
            );
          }
          return {
            argv: ['sandbox-exec', '-p', seatbeltProfile(policy), ...argv],
            enforcement: 'full',
            runner: 'seatbelt',
          };
        }

        throw new AgentError(
          'SANDBOX_UNAVAILABLE',
          `No OS sandbox provider is available for ${process.platform}`
        );
      },
      catch: (error) =>
        error instanceof AgentError
          ? error
          : new AgentError('SANDBOX_UNAVAILABLE', String(error), { cause: error }),
    });
  },
};
