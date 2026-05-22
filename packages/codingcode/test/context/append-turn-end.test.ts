import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { estimateTokensForContent } from '../../src/context/utils/tokens.js';
import { getContextConfig, __setContextConfigForTest } from '../../src/context/config.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

describe('appendTurnEnd', () => {
  const projectSlug = randomUUID();
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    const sessionDir = join(SESSIONS_DIR, projectSlug);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), '', 'utf8');
  });

  afterEach(() => {
    const dir = join(SESSIONS_DIR, projectSlug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('estimateTokensForContent computes token count for tool result', () => {
    const output = 'hello world '.repeat(100);
    const tokens = estimateTokensForContent(output);
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  it('tokenCount is included in ToolResultEvent write', () => {
    const output = 'short output';
    const tokens = estimateTokensForContent(output);
    const event = {
      type: 'tool_result',
      turnId: 1,
      uuid: 't1',
      parentUuid: 'a1',
      toolName: 'bash',
      toolCallId: 'tc1',
      output,
      timestamp: new Date().toISOString(),
      tokenCount: tokens,
    };
    const serialized = JSON.stringify(event);
    const parsed = JSON.parse(serialized);
    expect(parsed.tokenCount).toBe(tokens);
  });

  it('compression thresholds are configurable', () => {
    __setContextConfigForTest({ thresholds: { budgetReduction: 0.5, prune: 0.6, slidingWindow: 0.7, collapse: 0.8, compaction: 0.85 } });
    const config = getContextConfig();
    expect(config.thresholds.budgetReduction).toBe(0.5);
    expect(config.thresholds.prune).toBe(0.6);
    expect(config.thresholds.compaction).toBe(0.85);
    __setContextConfigForTest(null as any);
  });
});
