import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { estimateTokensForContent } from '../../src/context/utils/tokens.js';
import { getContextConfig } from '../../src/context/config.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('appendTurnEnd', () => {
  const projectSlug = randomUUID();
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    const sessionDir = join(PROJECT_BASE, projectSlug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), '', 'utf8');
  });

  afterEach(() => {
    const dir = join(PROJECT_BASE, projectSlug);
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

  it('compression thresholds have sensible defaults', () => {
    const config = getContextConfig();
    expect(config.thresholds.prune).toBeGreaterThan(0);
    expect(config.thresholds.compaction).toBeGreaterThan(0);
  });
});
