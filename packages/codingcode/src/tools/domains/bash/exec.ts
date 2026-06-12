import { z } from 'zod';
import { spawn } from 'child_process';
import { Effect } from 'effect';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';

import { AgentError } from '../../../core/error.js';

export const bashTool: ToolDefinition = {
  name: 'execute_command',
  description:
    'Execute a shell command and return its output. Use for running tests, git, npm, build, and other CLI operations.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z.string().optional().describe('Working directory (defaults to project root)'),
    timeout_ms: z.number().int().default(30000).describe('Timeout in milliseconds'),
  }),
  execute: (args: unknown, ctx?: ToolExecCtx) => {
    const { command, cwd, timeout_ms } = args as any;
    const workDir = cwd || ctx?.projectPath || process.cwd();
    return Effect.async<string, AgentError>((resume) => {
      const proc = spawn(command, {
        shell: true,
        cwd: workDir,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      // Kill process when abort signal fires (e.g. user clicks stop)
      const onAbort = () => {
        proc.kill();
      };
      ctx?.signal?.addEventListener('abort', onAbort, { once: true });

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
        resume(Effect.succeed(`Command timed out after ${timeout_ms}ms\nStdout:\n${stdout}\nStderr:\n${stderr}`));
      }, timeout_ms);

      proc.on('close', (code) => {
        clearTimeout(timer);
        ctx?.signal?.removeEventListener('abort', onAbort);
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
        ctx?.signal?.removeEventListener('abort', onAbort);
        resume(
          Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', `Command failed to start: ${err.message}`, err))
        );
      });
    });
  },
};
