import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

const mockProc = Object.assign(new EventEmitter(), {
  stdout: Object.assign(new EventEmitter(), { on: vi.fn() }),
  stderr: Object.assign(new EventEmitter(), { on: vi.fn() }),
  kill: vi.fn(),
});

const spawnMock = vi.fn(() => mockProc);

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

const { bashTool } = await import('../../../../src/tools/domains/bash/exec.js');
const { AgentError } = await import('../../../../src/core/error.js');

describe('tools/domains/bash exec error', () => {
  it('rejects with AgentError when spawn emits error', async () => {
    const promise = bashTool.execute({ command: 'echo test', timeout_ms: 5000 });
    mockProc.emit('error', new Error('spawn failed'));
    await expect(promise).rejects.toBeInstanceOf(AgentError);
  });

  it('rejects with TOOL_EXECUTION_FAILED code', async () => {
    const promise = bashTool.execute({ command: 'echo test', timeout_ms: 5000 });
    mockProc.emit('error', new Error('spawn failed'));
    await expect(promise).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
  });
});
