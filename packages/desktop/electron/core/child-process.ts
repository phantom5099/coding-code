import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { app } from 'electron';

let child: ChildProcess | null = null;

function getCliPath(): string {
  const root = resolve(app.getAppPath(), '../../');
  return resolve(root, 'packages/codingcode/src/cli.ts');
}

function getProjectRoot(): string {
  return resolve(app.getAppPath(), '../../');
}

export async function startBackend(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const cliPath = getCliPath();
    const root = getProjectRoot();
    const isWin = process.platform === 'win32';

    if (isWin) {
      // On Windows, .cmd files require shell mode, but spawn with shell:true
      // does not auto-quote arguments. Paths with spaces get split.
      // Solution: construct the full command string and pass it directly.
      const tsxPath = resolve(root, 'node_modules/.bin/tsx.cmd');
      const cmd = `"${tsxPath}" "${cliPath}" serve`;
      child = spawn(cmd, [], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } else {
      // On Unix, no shell needed — spawn handles paths with spaces natively.
      const tsxPath = resolve(root, 'node_modules/.bin/tsx');
      child = spawn(tsxPath, [cliPath, 'serve'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    let settled = false;

    child.stdout!.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/^CODINGCODE_SERVER_READY:(\d+)$/);
        if (match && !settled) {
          settled = true;
          resolvePromise(parseInt(match[1], 10));
        }
      }
    });

    child.stderr!.on('data', (data: Buffer) => {
      // Windows cmd.exe outputs in GBK, decode as latin1 to avoid mojibake
      const text = isWin ? data.toString('latin1') : data.toString();
      console.error('[backend]', text.trim());
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Backend process exited with code ${code}`));
      }
    });
  });
}

export function stopBackend(): void {
  if (child) {
    child.kill();
    child = null;
  }
}
