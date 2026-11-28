import { z } from 'zod';
import { spawn } from 'child_process';
import { Effect } from 'effect';
import { defineTool } from '@codingcode/tool';
import { AgentError } from '@codingcode/util';
import {
  localSandboxProvider,
  resolveFileTarget,
  type DangerousOperation,
} from '@codingcode/sandbox';

const bashParams = z.object({
  command: z.string().describe('The shell command to execute'),
  cwd: z.string().optional().describe('Working directory (defaults to project root)'),
  timeout_ms: z.number().int().default(30000).describe('Timeout in milliseconds'),
});

export const bashTool = defineTool({
  name: 'execute_command',
  concurrencySafe: false,
  approval: { action: 'exec', requiresConfirmation: true, dangerous: ['process_control'] },
  describeOperation: (args) => {
    const command = args.command ?? '';
    const dangerous: DangerousOperation[] = [];
    if (
      /\b(rm|del|rd|rmdir)\b.*(?:-rf|\/s)/i.test(command) ||
      /\b(find .* -delete|git\s+clean .*-[df]|git\s+reset\s+--hard)\b/i.test(command)
    ) {
      dangerous.push('destructive_delete');
    }
    if (/\b(chmod|chown|icacls)\b/i.test(command)) dangerous.push('permission_change');
    if (/\b(kill|pkill|shutdown|reboot|systemctl|sc\.exe)\b/i.test(command))
      dangerous.push('process_control');
    if (
      /(curl|wget|Invoke-WebRequest)[^\n]*(\||;|&&)[^\n]*(sh|bash|powershell|iex)\b/i.test(command)
    ) {
      dangerous.push('remote_code_fetch');
    }
    if (/\b(curl|wget|Invoke-WebRequest|npm|pnpm|yarn|pip|git\s+clone)\b/i.test(command))
      dangerous.push('network_unrestricted');
    if (/\b(git\s+(reset|rebase|push\s+--force)|git\s+clean)\b/i.test(command))
      dangerous.push('repository_history_write');
    return { action: 'exec', requiresConfirmation: true, dangerous };
  },
  description:
    'Execute a shell command and return its output. Use for running tests, git, npm, build, and other CLI operations.',
  parameters: bashParams,
  execute: (args, ctx) => {
    const { command, cwd, timeout_ms } = args;
    return Effect.gen(function* () {
      if (!ctx?.session?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_UNAVAILABLE', 'execute_command requires a sandbox policy')
        );
      }
      const workDir = yield* Effect.tryPromise({
        try: () => resolveFileTarget(ctx.sandboxPolicy!, { path: cwd || '.', operation: 'read' }),
        catch: (error) =>
          error instanceof AgentError
            ? error
            : AgentError.toolExecutionFailed('execute_command', error),
      });
      const shellArgv =
        process.platform === 'win32'
          ? ['cmd.exe', '/d', '/s', '/c', command]
          : ['/bin/sh', '-lc', command];
      const confined = yield* localSandboxProvider.confine(shellArgv, ctx.sandboxPolicy);
      if (ctx.sandboxPolicy.enforcement === 'required' && confined.enforcement !== 'full') {
        return yield* Effect.fail(
          new AgentError(
            'SANDBOX_UNAVAILABLE',
            'The command sandbox did not provide full enforcement'
          )
        );
      }
      return yield* Effect.async<string, AgentError>((resume) => {
        const [program, ...argv] = confined.argv;
        const proc = spawn(program!, argv, {
          shell: false,
          cwd: workDir,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        const onAbort = () => {
          proc.kill();
        };
        ctx.signal?.addEventListener('abort', onAbort, { once: true });

        proc.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
          if (stdout.length > 100_000) {
            stdout = stdout.slice(0, 100_000) + '\n... (truncated)';
            proc.kill();
          }
        });

        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
          if (stderr.length > 50_000) stderr = stderr.slice(0, 50_000);
        });

        const timer = setTimeout(() => {
          proc.kill();
          resume(
            Effect.succeed(
              `Command timed out after ${timeout_ms}ms\nStdout:\n${stdout}\nStderr:\n${stderr}`
            )
          );
        }, timeout_ms);

        proc.on('close', (code) => {
          clearTimeout(timer);
          ctx.signal?.removeEventListener('abort', onAbort);
          resume(
            Effect.succeed(
              [
                `Exit code: ${code ?? 'null'}`,
                stdout ? `Stdout:\n${stdout}` : '',
                stderr ? `Stderr:\n${stderr}` : '',
              ]
                .filter(Boolean)
                .join('\n') || '(no output)'
            )
          );
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          ctx.signal?.removeEventListener('abort', onAbort);
          resume(
            Effect.fail(
              new AgentError(
                'TOOL_EXECUTION_FAILED',
                `Command failed to start: ${err.message}`,
                { cause: err }
              )
            )
          );
        });
      });
    });
  },
});
