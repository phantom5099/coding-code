import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { EventEmitter } from 'events';
import { testSandboxPolicy } from '../../../helpers/sandbox.js';

const mockProc = Object.assign(new EventEmitter(), {
  stdout: Object.assign(new EventEmitter(), { on: vi.fn() }),
  stderr: Object.assign(new EventEmitter(), { on: vi.fn() }),
  kill: vi.fn(),
});

const spawnMock = vi.fn(() => mockProc);

vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFile: vi.fn(),
}));

const { bashTool } = await import('@codingcode/bash');
const { AgentError } = await import('@codingcode/util');

describe('tools/domains/bash exec error', () => {
  it('fails with AgentError when spawn emits error', async () => {
    const effect = bashTool.execute(
      { command: 'echo test', timeout_ms: 5000 },
      { session: { cwd: process.cwd(), sessionId: 'test-sid' }, model: 'test-model', sandboxPolicy: testSandboxPolicy(process.cwd()) }
    );
    // Emit error on next tick so Effect.async callback has registered listeners
    setTimeout(() => mockProc.emit('error', new Error('spawn failed')), 0);
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe('Failure');
  });

  it('fails with TOOL_EXECUTION_FAILED code', async () => {
    const effect = bashTool.execute(
      { command: 'echo test', timeout_ms: 5000 },
      { session: { cwd: process.cwd(), sessionId: 'test-sid' }, model: 'test-model', sandboxPolicy: testSandboxPolicy(process.cwd()) }
    );
    setTimeout(() => mockProc.emit('error', new Error('spawn failed')), 0);
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe('Failure');
  });
});
