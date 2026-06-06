import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { compactWithLLM } from '../../../src/context/compressor/index.js';
import type { ContextConfig } from '../../../src/context/config.js';
import type { LLMClient } from '../../../src/llm/client.js';
import { Result } from '../../../src/core/result.js';
import type { SessionIndex, SessionEvent, SummaryEvent } from '../../../src/session/types.js';
import { buildMessages } from '../../../src/session/messages.js';
import { estimateTokens } from '../../../src/context/utils/tokens.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

interface FixtureOptions {
  numTurns: number;
  toolContentSize?: number;
  toolName?: string;
  currentTurnId?: number;
}

function makeFixture(opts: FixtureOptions) {
  const sessionId = randomUUID();
  const slug = randomUUID();
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      projectPath: slug,
      cwd: '/tmp/test',
      model: 'test',
      createdAt: new Date().toISOString(),
    },
  ];

  const toolContent = 'X'.repeat(opts.toolContentSize ?? 8000);
  for (let turn = 1; turn <= opts.numTurns; turn++) {
    lines.push({
      type: 'user',
      turnId: turn,
      uuid: `u${turn}`,
      content: `q${turn}`,
      timestamp: new Date().toISOString(),
    });
    lines.push({
      type: 'assistant',
      turnId: turn,
      uuid: `a${turn}`,
      content: `r${turn}`,
      toolCalls: [{ id: `tc${turn}`, name: opts.toolName ?? 'bash', arguments: '{}' }],
      model: 'test',
      timestamp: new Date().toISOString(),
    });
    lines.push({
      type: 'tool_result',
      turnId: turn,
      uuid: `t${turn}`,
      parentUuid: `a${turn}`,
      toolName: opts.toolName ?? 'bash',
      toolCallId: `tc${turn}`,
      output: toolContent,
      timestamp: new Date().toISOString(),
      tokenCount: Math.ceil(toolContent.length / 3.5),
    });
  }

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: opts.numTurns * 3,
    title: 'fixture',
    currentTurnId: opts.currentTurnId ?? opts.numTurns,
    usage: undefined,
    promptEstimate: 0,
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { sessionId, slug, dir, transcriptPath, indexPath };
}

function cleanup(slug: string) {
  const dir = join(PROJECT_BASE, slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function readSummaryEvents(jsonlPath: string): SummaryEvent[] {
  const content = readFileSync(jsonlPath, 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionEvent)
    .filter((ev): ev is SummaryEvent => ev.type === 'summary');
}

function tinyConfig(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    microCompactThreshold: 0.5,
    microCompactMinChars: 120,
    compactionThreshold: 0.5,
    keepRecentTurns: 2,
    compactionModel: '',
    reactiveCompactMaxRetries: 1,
    ...overrides,
  };
}

function makeMockLLM(content: string): LLMClient {
  return {
    complete: async () => Result.ok({ content, finishReason: 'stop' as const }),
    completeStream: () => ({
      stream: (async function* () {
        yield content;
      })(),
      response: Promise.resolve(Result.ok({ content, finishReason: 'stop' as const })),
    }),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 1000,
      supportsToolCalling: false,
      supportsStreaming: true,
    },
  };
}

describe('compressor behavior', () => {
  describe('L5 compaction', () => {
    it('writes summary event with five-section system summary', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ keepRecentTurns: 2 });
        const summary =
          '## Compacted History\n\n### Goal\nfix bug\n\n### Instructions\nbe careful\n\n### Discoveries\nrace condition\n\n### Accomplished\npatched\n\n### Relevant Files\nsrc/x.ts';
        const llm = makeMockLLM(summary);
        await compactWithLLM(fx.sessionId, fx.slug, cfg, llm);
        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries.length).toBe(1);
        expect(summaries[0]!.summaryText).toContain('### Goal');
        expect(summaries[0]!.replaces.length).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });

    it('returns no-op when no LLM available', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ keepRecentTurns: 2 });
        const result = await compactWithLLM(fx.sessionId, fx.slug, cfg, null);
        expect(result.didCompress).toBe(false);
        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries).toHaveLength(0);
      } finally {
        cleanup(fx.slug);
      }
    });
  });

  describe('summary events update JSONL', () => {
    it('appends summary event directly to JSONL after L5', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const cfg = tinyConfig({ keepRecentTurns: 2 });
        const llm = makeMockLLM(
          '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
        );
        await compactWithLLM(fx.sessionId, fx.slug, cfg, llm);

        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries).toHaveLength(1);
        expect(summaries[0]!.replaces.length).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });
  });

  describe('compactWithLLM result', () => {
    it('returns promptEstimate after compression', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const before = estimateTokens(buildMessages(fx.transcriptPath));
        const cfg = tinyConfig({ keepRecentTurns: 2 });
        const llm = makeMockLLM(
          '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
        );
        const result = await compactWithLLM(fx.sessionId, fx.slug, cfg, llm);
        expect(result.didCompress).toBe(true);
        expect(result.promptEstimate).toBeGreaterThan(0);
        expect(result.promptEstimate).toBeLessThan(before);
        expect(result.released).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });
  });
});
