import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  beforeEach(() => {
    vi.clearAllMocks();
    stopBackend();
  });

  it('spawns tsx with serve argument and resolves port', async () => {
    const mockCp = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockCp);

    const promise = startBackend();

    // On the test platform (non-Windows or Windows), verify spawn was called
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = vi.mocked(spawn).mock.calls[0];
    // Command or first arg should contain tsx
    const fullCmd = typeof cmd === 'string' ? cmd : '';
    const fullArgs = Array.isArray(args) ? args.join(' ') : '';
    expect(fullCmd + ' ' + fullArgs).toContain('tsx');
    expect(fullCmd + ' ' + fullArgs).toContain('cli.ts');
    expect(fullCmd + ' ' + fullArgs).toContain('serve');

    // Simulate the CLI outputting the ready signal
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
