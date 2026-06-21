import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { estimateTokensForContent } from '../../src/core/util.js';
import { useTempProjectBase } from '../helpers/project-base.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
      extraTypes: [],
      disabledTypes: [],
    },
    server: { port: 8080 },
  }),
}));

const base = useTempProjectBase();

describe('appendTurnEnd', () => {
  const projectSlug = randomUUID();
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    const sessionDir = join(base.dir, projectSlug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), '', 'utf8');
  });

  afterEach(() => {
    const dir = join(base.dir, projectSlug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('estimateTokensForContent computes token count for tool result', () => {
    const output = 'hello world '.repeat(100);
    const tokens = estimateTokensForContent(output);
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });
});
