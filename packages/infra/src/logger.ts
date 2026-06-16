import pino from 'pino';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

export type Logger = pino.Logger;

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  const isElectron = !!(process as any).versions?.electron;
  if (isElectron) {
    return (pino as any)({ level });
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    // 生产模式：使用 pino.destination 同步写入文件，不依赖 worker 线程
    // 这样可以被 esbuild 打包为单文件，无需额外 node_modules
    const logDir = join(homedir(), '.codingcode', 'logs');
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {}
    const dest = join(logDir, 'app.log');
    return (pino as any)({ level }, (pino as any).destination(dest));
  }
  return (pino as any)({
    level,
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });
}
