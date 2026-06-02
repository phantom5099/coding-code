import { describe, it, expect, vi } from 'vitest';
import { executeHookCommand } from '../../src/hooks/executor';
import { EventEmitter } from 'events';

const createMockProc = () => Object.assign(new EventEmitter(), {
  stdout: Object.assign(new EventEmitter(), { on: vi.fn() }),
  stderr: Object.assign(new EventEmitter(), { on: vi.fn() }),
  kill: vi.fn(),
  stdin: { write: vi.fn(), end: vi.fn() },
});

let _mockProc = createMockProc();

vi.mock('child_process', () => ({
  spawn: () => _mockProc,
}));

describe('hooks/executor error propagation', () => {
  it('rejects when spawn emits error', async () => {
    _mockProc = createMockProc();
    const promise = executeHookCommand(
      { command: 'test-cmd' },
      { foo: 'bar' },
    );
    _mockProc.emit('error', new Error('spawn failed'));
    await expect(promise).rejects.toThrow('spawn failed');
  });

  it('rejects on timeout', async () => {
    const origSetTimeout = globalThis.setTimeout;
    let timerCb: (() => void) | null = null;
    (globalThis as any).setTimeout = (cb: () => void, _ms: number) => {
      timerCb = cb;
      return 999 as any;
    };

    _mockProc = createMockProc();
    const p = executeHookCommand({ command: 'test-cmd' }, { foo: 'bar' });
    expect(timerCb).not.toBeNull();
    timerCb!();
    (globalThis as any).setTimeout = origSetTimeout;

    await expect(p).rejects.toThrow('Hook timed out');
  });
});
