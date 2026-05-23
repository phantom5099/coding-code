import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { ToolDedupService } from '../../src/tools/dedup/service';
import { buildRepeatReminder } from '../../src/agent/build-tools';
import { ToolDedupLayer } from '../../src/layer';

describe('buildRepeatReminder', () => {
  const testEffect = (testFn: (dedup: ToolDedupService) => void) => {
    return Effect.gen(function* () {
      const dedup = yield* ToolDedupService;
      testFn(dedup);
    }).pipe(Effect.provide(ToolDedupLayer));
  };

  it('should return null when no repeats detected', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder).toBeNull();
      }),
    );
  });

  it('should return system message when repeats detected', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 4; i++) {
          dedup.record(agentId, 'read_file', { path: '/test.txt' }, `call-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder).not.toBeNull();
        expect(reminder?.role).toBe('system');
        expect(reminder?.content).toContain('repeated');
        expect(reminder?.content).toContain('read_file');
      }),
    );
  });

  it('should include tool names in reminder', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'bash', { command: 'ls' }, `call-bash-${i}`);
        }
        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'read_file', { path: '/test.txt' }, `call-read-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder?.content).toContain('bash');
        expect(reminder?.content).toContain('read_file');
      }),
    );
  });

  it('should not be persisted to JSONL (ephemeral)', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'bash', { command: 'ls' }, `call-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder?.role).toBe('system');
      }),
    );
  });

  it('should be isolated by agent ID', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        for (let i = 0; i < 3; i++) {
          dedup.record('agent-1', 'bash', { command: 'ls' }, `call-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, 'agent-2');
        expect(reminder).toBeNull();
      }),
    );
  });

  it('should reset after being retrieved', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'bash', { command: 'ls' }, `call-${i}`);
        }
        const reminder1 = buildRepeatReminder(dedup, agentId);
        expect(reminder1).not.toBeNull();
        dedup.reset();
        const reminder2 = buildRepeatReminder(dedup, agentId);
        expect(reminder2).toBeNull();
      }),
    );
  });

  it('should work with different tool arguments', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'edit_file', { file: '/file1.txt', edits: [] }, `call-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder?.content).toContain('repeated');
        expect(reminder?.content).toContain('edit_file');
      }),
    );
  });

  it('should format count information in reminder', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        for (let i = 0; i < 5; i++) {
          dedup.record(agentId, 'bash', { command: 'test' }, `call-${i}`);
        }
        const reminder = buildRepeatReminder(dedup, agentId);
        expect(reminder?.content).toMatch(/bash/);
        expect(reminder?.content.length).toBeGreaterThan(20);
      }),
    );
  });
});
