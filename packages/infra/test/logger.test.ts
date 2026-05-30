import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    expect(() => logger.info('test')).not.toThrow();
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
    expect(() => logger.info('test')).not.toThrow();
  });

  it('returns file logger in production Node.js', async () => {
    const versions = { ...process.versions };
    delete (versions as any).electron;
    setVersions(versions);
    process.env.NODE_ENV = 'production';

    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger('warn');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('warn');
  });
});
