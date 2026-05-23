import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { ToolDedupService } from '../../src/tools/dedup/service';
import { ToolDedupLayer } from '../../src/layer';

describe('ToolDedupService', () => {
  const testEffect = (testFn: (dedup: ToolDedupService) => void) => {
    return Effect.gen(function* () {
      const dedup = yield* ToolDedupService;
      testFn(dedup);
    }).pipe(Effect.provide(ToolDedupLayer));
  };

  it('should record tool calls', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');
        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-2');

        const isFirst = dedup.isFirst(agentId, 'read_file', { path: '/test.txt' });
        expect(isFirst).toBe(false);
      }),
    );
  });

  it('should detect first call as unique', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        const isFirst = dedup.isFirst(agentId, 'read_file', { path: '/test.txt' });
        expect(isFirst).toBe(true);
      }),
    );
  });

  it('should detect repeated calls', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');
        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-2');

        const isFirst = dedup.isFirst(agentId, 'read_file', { path: '/test.txt' });
        expect(isFirst).toBe(false);
      }),
    );
  });

  it('should isolate dedup by agent ID', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        dedup.record('agent-1', 'read_file', { path: '/test.txt' }, 'call-1');

        const isFirst = dedup.isFirst('agent-2', 'read_file', { path: '/test.txt' });
        expect(isFirst).toBe(true);
      }),
    );
  });

  it('should distinguish calls by parameters', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'read_file', { path: '/file1.txt' }, 'call-1');

        const isFirst = dedup.isFirst(agentId, 'read_file', { path: '/file2.txt' });
        expect(isFirst).toBe(true);
      }),
    );
  });

  it('should handle repeated calls across window', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';
        const args = { path: '/test.txt' };

        for (let i = 0; i < 3; i++) {
          dedup.record(agentId, 'read_file', args, `call-${i}`);
        }

        const summary = dedup.summary(agentId);
        const entry = summary.find(e => e.name === 'read_file');

        expect(entry).toBeDefined();
        expect(entry?.count).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it('should provide summary of repeated calls', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'bash', { command: 'ls' }, 'call-1');
        dedup.record(agentId, 'bash', { command: 'ls' }, 'call-2');
        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-3');

        const summary = dedup.summary(agentId);

        expect(summary.length).toBeGreaterThanOrEqual(1);
        const bashEntry = summary.find(e => e.name === 'bash');
        expect(bashEntry?.count).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('should reset dedup data', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');
        dedup.reset();

        const isFirst = dedup.isFirst(agentId, 'read_file', { path: '/test.txt' });
        expect(isFirst).toBe(true);
      }),
    );
  });

  it('should handle different tool names', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');
        dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-2');
        dedup.record(agentId, 'bash', { command: 'ls' }, 'call-3');
        dedup.record(agentId, 'bash', { command: 'ls' }, 'call-4');

        const summary = dedup.summary(agentId);
        expect(summary.some(e => e.name === 'read_file')).toBe(true);
        expect(summary.some(e => e.name === 'bash')).toBe(true);
      }),
    );
  });

  it('should handle large argument values', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        const largeContent = 'x'.repeat(10000);
        dedup.record(agentId, 'write_file', { content: largeContent }, 'call-1');
        dedup.record(agentId, 'write_file', { content: largeContent }, 'call-2');

        const isFirst = dedup.isFirst(agentId, 'write_file', { content: largeContent });
        expect(isFirst).toBe(false);
      }),
    );
  });

  it('should handle empty arguments', async () => {
    await Effect.runPromise(
      testEffect((dedup) => {
        const agentId = 'agent-1';

        dedup.record(agentId, 'tool1', {}, 'call-1');
        dedup.record(agentId, 'tool1', {}, 'call-2');

        const isFirst = dedup.isFirst(agentId, 'tool1', {});
        expect(isFirst).toBe(false);
      }),
    );
  });
});
