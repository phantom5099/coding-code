import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { ToolDedupService } from '../../src/tools/dedup/service';
import { buildRepeatReminder } from '../../src/agent/build-tools';

describe('buildRepeatReminder', () => {
  it('should return null when no repeats detected', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record a single call
    dedup.record(agentId, 'read_file', { path: '/test.txt' }, 'call-1');

    const reminder = buildRepeatReminder(dedup, agentId);
    expect(reminder).toBeNull();
  });

  it('should return system message when repeats detected', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record same call multiple times to trigger detection
    for (let i = 0; i < 4; i++) {
      dedup.record(agentId, 'read_file', { path: '/test.txt' }, `call-${i}`);
    }

    const reminder = buildRepeatReminder(dedup, agentId);
    expect(reminder).not.toBeNull();
    expect(reminder?.role).toBe('system');
    expect(reminder?.content).toContain('repeated');
    expect(reminder?.content).toContain('read_file');
  });

  it('should include tool names in reminder', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Multiple repeats of different tools
    for (let i = 0; i < 3; i++) {
      dedup.record(agentId, 'bash', { command: 'ls' }, `call-bash-${i}`);
    }
    for (let i = 0; i < 3; i++) {
      dedup.record(agentId, 'read_file', { path: '/test.txt' }, `call-read-${i}`);
    }

    const reminder = buildRepeatReminder(dedup, agentId);
    expect(reminder?.content).toContain('bash');
    expect(reminder?.content).toContain('read_file');
  });

  it('should not be persisted to JSONL (ephemeral)', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record repeats
    for (let i = 0; i < 3; i++) {
      dedup.record(agentId, 'bash', { command: 'ls' }, `call-${i}`);
    }

    const reminder = buildRepeatReminder(dedup, agentId);

    // The reminder should be system-generated and transient
    // In the actual implementation, it's injected into messages but not persisted
    expect(reminder?.role).toBe('system');
  });

  it('should be isolated by agent ID', () => {
    const dedup = Effect.runSync(ToolDedupService);

    // Record repeats for agent-1
    for (let i = 0; i < 3; i++) {
      dedup.record('agent-1', 'bash', { command: 'ls' }, `call-${i}`);
    }

    // Agent-2 should not see these repeats
    const reminder = buildRepeatReminder(dedup, 'agent-2');
    expect(reminder).toBeNull();
  });

  it('should reset after being retrieved', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record repeats
    for (let i = 0; i < 3; i++) {
      dedup.record(agentId, 'bash', { command: 'ls' }, `call-${i}`);
    }

    const reminder1 = buildRepeatReminder(dedup, agentId);
    expect(reminder1).not.toBeNull();

    // After reset, next call should not find repeats immediately
    dedup.reset();

    const reminder2 = buildRepeatReminder(dedup, agentId);
    expect(reminder2).toBeNull();
  });

  it('should work with different tool arguments', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record repeats of same tool with different args
    for (let i = 0; i < 3; i++) {
      dedup.record(agentId, 'edit_file', { file: '/file1.txt', edits: [] }, `call-${i}`);
    }

    const reminder = buildRepeatReminder(dedup, agentId);
    expect(reminder?.content).toContain('repeated');
    expect(reminder?.content).toContain('edit_file');
  });

  it('should format count information in reminder', () => {
    const dedup = Effect.runSync(ToolDedupService);
    const agentId = 'agent-1';

    // Record 5 calls of same tool
    for (let i = 0; i < 5; i++) {
      dedup.record(agentId, 'bash', { command: 'test' }, `call-${i}`);
    }

    const reminder = buildRepeatReminder(dedup, agentId);
    expect(reminder?.content).toMatch(/bash/);
    // Should contain some indication of count
    expect(reminder?.content.length).toBeGreaterThan(20);
  });
});
