import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/app/path' },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { startBackend, stopBackend } from '../electron/core/child-process';

function createMockChildProcess() {
  const cp = new EventEmitter() as any;
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.kill = vi.fn();
  return cp;
}

describe('child-process', () => {
  let originalRendererUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stopBackend();
    originalRendererUrl = process.env.ELECTRON_RENDERER_URL;
  });

  afterEach(() => {
    if (originalRendererUrl !== undefined) {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
    } else {
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });

  describe('dev mode (ELECTRON_RENDERER_URL set)', () => {
    beforeEach(() => {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    });

    it('spawns tsx with serve argument and resolves port', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      expect(spawn).toHaveBeenCalledTimes(1);
      const [cmd, args, options] = vi.mocked(spawn).mock.calls[0];
      const fullCmd = typeof cmd === 'string' ? cmd : '';
      const fullArgs = Array.isArray(args) ? args.join(' ') : '';
      expect(fullCmd + ' ' + fullArgs).toContain('tsx');
      expect(fullCmd + ' ' + fullArgs).toContain('cli.ts');
      expect(fullCmd + ' ' + fullArgs).toContain('serve');

      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:9090\n'));

      const port = await promise;
      expect(port).toBe(9090);
    });

    it('rejects if child process exits before ready', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      mockCp.emit('exit', 1);

      await expect(promise).rejects.toThrow('Backend process exited with code 1');
    });

    it('rejects if child process errors before ready', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      mockCp.emit('error', new Error('spawn failed'));

      await expect(promise).rejects.toThrow('spawn failed');
    });

    it('ignores non-ready stdout lines', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      mockCp.stdout.emit('data', Buffer.from('Workspace: /some/path\n'));
      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:8080\n'));

      const port = await promise;
      expect(port).toBe(8080);
    });

    it('stopBackend kills the child process', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();
      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:8080\n'));
      await promise;

      stopBackend();

      expect(mockCp.kill).toHaveBeenCalled();
    });

    it('stopBackend is safe when no child is running', () => {
      expect(() => stopBackend()).not.toThrow();
    });

    it('resolves only the first ready signal', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:8080\n'));
      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:9090\n'));

      const port = await promise;
      expect(port).toBe(8080);
    });
  });

  describe('production mode (no ELECTRON_RENDERER_URL)', () => {
    beforeEach(() => {
      delete process.env.ELECTRON_RENDERER_URL;
    });

    it('spawns node with bundled cli.bundle.js and serve argument', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      expect(spawn).toHaveBeenCalledTimes(1);
      const [cmd, args, options] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('node');
      expect(Array.isArray(args)).toBe(true);
      const argStr = (args as string[]).join(' ');
      expect(argStr).toContain('cli.bundle.js');
      expect(argStr).toContain('serve');

      // 生产模式应设置 NODE_ENV=production
      const env = (options as any)?.env;
      expect(env?.NODE_ENV).toBe('production');

      // 生产模式 cwd 应指向 resources 目录（而非 process.cwd()）
      const cwd = (options as any)?.cwd;
      expect(cwd).toBeDefined();
      expect(cwd).not.toBe(process.cwd());
      expect(cwd.toLowerCase()).toContain('resources');

      mockCp.stdout.emit('data', Buffer.from('CODINGCODE_SERVER_READY:3000\n'));

      const port = await promise;
      expect(port).toBe(3000);
    });

    it('rejects if child process exits before ready in production', async () => {
      const mockCp = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockCp);

      const promise = startBackend();

      mockCp.emit('exit', 1);

      await expect(promise).rejects.toThrow('Backend process exited with code 1');
    });
  });
});
