import pino from 'pino';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { getGlobalDir } from '@codingcode/util';

export type Logger = pino.Logger;
export type LogLevel = pino.LevelWithSilent;

const pinoFn = pino as unknown as ((
  options?: pino.LoggerOptions,
  stream?: pino.DestinationStream
) => pino.Logger) & {
  destination: typeof pino.destination;
};

export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  const isElectron = Boolean((process.versions as { readonly electron?: string }).electron);
  if (isElectron) {
    return pinoFn({ level });
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    // 生产模式：同步写文件，不依赖 worker 线程，便于 esbuild 打成单文件
    const logDir = join(getGlobalDir(), 'logs');
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {}
    const dest = join(logDir, 'app.log');
    return pinoFn({ level }, pinoFn.destination(dest));
  }
  return pinoFn({
    level,
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });
}
