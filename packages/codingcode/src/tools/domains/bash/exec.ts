import { z } from 'zod';
import { spawn } from 'child_process';
import type { ToolDefinition } from '../../types';

export const bashTool: ToolDefinition = {
  name: 'execute_command',
  description:
    'Execute a shell command and return its output. Use for: running tests, checking git status, installing packages, building projects. Commands are sandboxed.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z.string().optional().describe('Working directory (defaults to project root)'),
    timeout_ms: z.number().int().default(30000).describe('Timeout in ms'),
  }),
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
      timeout_ms: { type: 'integer', default: 30000, description: 'Timeout in ms' },
    },
    required: ['command'],
  },
  execute: async (args: unknown) => {
    const { command, cwd, timeout_ms } = args as any;
    const workDir = cwd || process.cwd();
    return new Promise<string>((resolve) => {
      const proc = spawn(command, {
        shell: true,
        cwd: workDir,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

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
        resolve(
          `Command timed out after ${timeout_ms}ms\nStdout:\n${stdout}\nStderr:\n${stderr}`,
        );
      }, timeout_ms);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve(
          [
            `Exit code: ${code ?? 'null'}`,
            stdout ? `Stdout:\n${stdout}` : '',
            stderr ? `Stderr:\n${stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n') || '(no output)',
        );
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve(`Command failed to start: ${err.message}`);
      });
    });
  },
};
