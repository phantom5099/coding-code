import pino from 'pino';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { getGlobalDir } from '../util/path.js';

export type Logger = pino.Logger;

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  const isElectron = !!(process as any).versions?.electron;
  if (isElectron) {
    return (pino as any)({ level });
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    // 生产模式：同步写文件，不依赖 worker 线程，便于 esbuild 打成单文件
    const logDir = join(getGlobalDir(), 'logs');
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
