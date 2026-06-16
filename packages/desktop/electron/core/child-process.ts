import { spawn, ChildProcess } from 'child_process';
import { resolve, join } from 'path';
import { app } from 'electron';

let child: ChildProcess | null = null;

function isDev(): boolean {
  // electron-vite 开发模式下会设置此环境变量
  return !!process.env.ELECTRON_RENDERER_URL;
}

function getResourcesDir(): string {
  return process.platform === 'darwin'
    ? join(process.execPath, '../../Resources')
    : join(process.execPath, '../resources');
}

function getBackendEntry(): string {
  if (isDev()) {
    return resolve(app.getAppPath(), '../../packages/codingcode/src/cli.ts');
  }
  // 生产模式：后端 bundle 通过 extraResources 放到 resources/backend/
  return join(getResourcesDir(), 'backend', 'cli.bundle.js');
}

function getProjectRoot(): string {
  if (isDev()) {
    return resolve(app.getAppPath(), '../../');
  }
  // 生产模式：config/models.json 通过 extraResources 放到 resources/config/
  return getResourcesDir();
}

export async function startBackend(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const entry = getBackendEntry();
    const root = getProjectRoot();
    const isWin = process.platform === 'win32';

    if (isDev()) {
      // 开发模式：tsx 运行 TypeScript 源码
      const tsxPath = resolve(root, 'node_modules/.bin/tsx.cmd');
      const cmd = `"${tsxPath}" "${entry}" serve`;
      child = spawn(cmd, [], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } else {
      // 生产模式：node 运行 esbuild 打包后的单文件
      child = spawn('node', [entry, 'serve'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
        },
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
