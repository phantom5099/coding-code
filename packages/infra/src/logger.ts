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
    const logDir = join(homedir(), '.codingcode', 'logs');
    try { mkdirSync(logDir, { recursive: true }); } catch {}
    return (pino as any)({
      level,
      transport: { target: 'pino/file', options: { destination: join(logDir, 'app.log') } },
    });
  }
  return (pino as any)({
    level,
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });
}
