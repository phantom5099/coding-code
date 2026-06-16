import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 捕获 pino 调用参数的 mock
const pinoCalls: any[] = [];
vi.mock('pino', () => {
  const mockLogger = {
    level: 'info',
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const mockPino: any = (opts: any, dest?: any) => {
    pinoCalls.push({ opts, dest });
    if (dest) {
      return { ...mockLogger, level: opts?.level ?? 'info' };
    }
    return { ...mockLogger, level: opts?.level ?? 'info' };
  };
  mockPino.destination = (path: string) => ({ type: 'destination', path });
  return { default: mockPino };
});

describe('createLogger', () => {
  let originalEnv: string | undefined;

  function setVersions(versions: Record<string, string | undefined>) {
    Object.defineProperty(process, 'versions', {
      value: versions,
      configurable: true,
      writable: false,
    });
  }

  beforeEach(() => {
    vi.resetModules();
    pinoCalls.length = 0;
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    setVersions(process.versions);
  });

  it('returns sync logger without transport in Electron', async () => {
    setVersions({ ...process.versions, electron: '35.0.0' });

    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger('debug');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
    // Electron 模式不使用 transport
    expect(pinoCalls[0]?.opts?.transport).toBeUndefined();
  });

  it('returns pino-pretty logger in dev Node.js', async () => {
    const versions = { ...process.versions };
    delete (versions as any).electron;
    setVersions(versions);
    process.env.NODE_ENV = 'development';

    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger('info');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
    // 开发模式使用 pino-pretty transport
    expect(pinoCalls[0]?.opts?.transport?.target).toBe('pino-pretty');
  });

  it('returns file logger via pino.destination in production Node.js', async () => {
    const versions = { ...process.versions };
    delete (versions as any).electron;
    setVersions(versions);
    process.env.NODE_ENV = 'production';

    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger('warn');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('warn');
    // 生产模式不使用 transport（避免 worker 线程依赖）
    expect(pinoCalls[0]?.opts?.transport).toBeUndefined();
    // 生产模式使用 pino.destination 写入文件
    expect(pinoCalls[0]?.dest).toBeDefined();
    expect(pinoCalls[0]?.dest?.type).toBe('destination');
    expect(pinoCalls[0]?.dest?.path).toContain('app.log');
  });
});
