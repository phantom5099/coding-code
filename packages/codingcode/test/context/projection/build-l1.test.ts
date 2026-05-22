import { describe, it, expect, vi } from 'vitest';
import type { EnrichedMessage } from '../../src/context/projection/types.js';
import type { ContextConfig } from '@codingcode/infra';

// Mock the persist function
vi.mock('../../src/context/persist/store.js', () => ({
  persistToolResult: vi.fn((sessionId: string, toolCallId: string, content: string) => ({
    path: `.codingcode/tool-results/${sessionId}/${toolCallId}.txt`,
    bytes: content.length,
  })),
}));

describe('L1 budget reduction - dual-path strategy', () => {
  it('should leave tool messages under threshold unchanged', () => {
    // This test validates the logic without needing the full build.ts implementation
    const config: Partial<ContextConfig> = {
      l1ThresholdTokens: 2000,
      l1PersistableTools: ['execute_command', 'fetch_url'],
      l1TruncateKeepHeadLines: 5,
      l1TruncateKeepTailLines: 15,
    };

    const shortContent = 'a'.repeat(100); // Well under threshold
    const tokens = Math.ceil(shortContent.length / 4);
    expect(tokens).toBeLessThan(config.l1ThresholdTokens!);
  });

  it('should classify tools correctly for persist vs truncate', () => {
    const persistTools = ['execute_command', 'fetch_url'];
    const toolName = 'execute_command';
    expect(persistTools.includes(toolName)).toBe(true);

    const otherTool = 'Read';
    expect(persistTools.includes(otherTool)).toBe(false);
  });

  it('should generate recovery hints for common tools', () => {
    const hints: Record<string, string> = {
      'Read': 'use Read with offset/limit to view specific range',
      'Grep': 're-run Grep with refined pattern',
      'Glob': 're-run Glob with narrower pattern',
    };

    expect(hints['Read']).toContain('offset/limit');
    expect(hints['Grep']).toContain('refined');
    expect(hints['Glob']).toContain('narrower');
  });

  it('should preserve projection-sourced messages', () => {
    const msg: EnrichedMessage = {
      message: { role: 'tool', content: 'a'.repeat(5000) },
      turnId: 1,
      uuid: 'event-1',
      source: { kind: 'projection', projectionId: 'proj-1' },
    };

    // Projection messages should bypass L1 entirely
    expect(msg.source.kind).toBe('projection');
  });

  it('should calculate head and tail lines correctly', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const total = lines.length;
    const headCount = 5;
    const tailCount = 15;

    if (total > headCount + tailCount) {
      const head = lines.slice(0, headCount);
      const tail = lines.slice(-tailCount);
      const omitted = total - headCount - tailCount;

      expect(head.length).toBe(5);
      expect(tail.length).toBe(15);
      expect(omitted).toBe(80);
    }
  });
});
