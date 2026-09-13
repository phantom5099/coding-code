import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../../src/context/port.js';
import type { ContextShape } from '../../../src/context/port.js';
import { SessionService } from '../../../src/session/port.js';
import { SessionLayer } from '../../../src/session/session.js';
import { LLMFactoryService } from '../../../src/llm/port.js';
import type { LLMClient } from '../../../src/llm/client.js';
import type { SessionIndex, SessionEvent, SummaryEvent } from '../../../src/session/types.js';
import { filterForContext, buildContextMessages } from '../../../src/context/context.js';
import { readHistory } from '../../../src/session/file-ops.js';
import { estimateTokens } from '../../../src/core/util.js';
import { useTempProjectBase } from '../../helpers/project-base.js';
import { ContextLayer } from '../../../src/context/context.js';

const base = useTempProjectBase();

interface FixtureOptions {
  numTurns: number;
  toolContentSize?: number;
  toolName?: string;
  currentTurnId?: number;
}

function makeFixture(opts: FixtureOptions) {
  const sessionId = randomUUID();
  const slug = randomUUID();
  const dir = join(base.dir, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      cwd: '/tmp/test',
      createdAt: new Date().toISOString(),
    },
  ];

  const toolContent = 'X'.repeat(opts.toolContentSize ?? 8000);
  for (let turn = 1; turn <= opts.numTurns; turn++) {
    lines.push({
      type: 'user',
      turnId: turn,
      content: `q${turn}`,
    });
    lines.push({
      type: 'assistant',
      turnId: turn,
      content: `r${turn}`,
      toolCalls: [{ id: `tc${turn}`, name: opts.toolName ?? 'bash', arguments: '{}' }],
    });
    lines.push({
      type: 'tool_result',
      turnId: turn,
      toolName: opts.toolName ?? 'bash',
      toolCallId: `tc${turn}`,
      output: toolContent,
    });
  }

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    cwd: '/tmp/test',
    model: 'test-model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: opts.numTurns * 3,
    title: 'fixture',
    currentTurnId: opts.currentTurnId ?? opts.numTurns,
    usage: undefined,
    activeProfile: 'build',
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { sessionId, slug, dir, transcriptPath, indexPath };
}

function cleanup(slug: string) {
  const dir = join(base.dir, slug);
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

function makeMockLLM(content: string): LLMClient {
  return {
    complete: () => Effect.succeed({ content }),
    completeStream: () =>
      (async function* () {
        yield { type: 'text' as const, text: content };
        yield { type: 'end' as const };
      })(),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 1000,
      supportsToolCalling: false,
      supportsStreaming: true,
    },
  };
}

const TestLayer = Layer.merge(
  SessionLayer,
  Layer.succeed(LLMFactoryService, {
    listModels: () => Effect.succeed([]),
    findModel: () => Effect.succeed(null),
    getActiveEntry: () => Effect.fail(new Error('no active model')),
    switchModel: () => Effect.fail(new Error('no models')),
    createClient: () => Effect.fail(new Error('no client')),
    getLLMClient: () => Effect.fail(new Error('no client')),
  } as any)
);

async function getCtxService(): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
  );
}

describe('compressor behavior', () => {
  describe('L5 compaction', () => {
    it('writes summary event with five-section system summary', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const summary =
          '## Compacted History\n\n### Goal\nfix bug\n\n### Instructions\nbe careful\n\n### Discoveries\nrace condition\n\n### Accomplished\npatched\n\n### Relevant Files\nsrc/x.ts';
        const llm = makeMockLLM(summary);
        const ctx = await getCtxService();
        await ctx.compactWithLLM(fx.transcriptPath, llm.modelInfo.maxTokens, llm);
        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries.length).toBe(1);
        expect(summaries[0]!.summaryText).toContain('### Goal');
        expect(summaries[0]!.startTurnId).toBeLessThanOrEqual(summaries[0]!.endTurnId);
        expect(summaries[0]!.endTurnId).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });

    it('returns no-op when no LLM available', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const ctx = await getCtxService();
        const result = await ctx.compactWithLLM(fx.transcriptPath, 1000, null);
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
        const llm = makeMockLLM(
          '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
        );
        const ctx = await getCtxService();
        await ctx.compactWithLLM(fx.transcriptPath, llm.modelInfo.maxTokens, llm);

        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries).toHaveLength(1);
        expect(summaries[0]!.startTurnId).toBeLessThanOrEqual(summaries[0]!.endTurnId);
        expect(summaries[0]!.endTurnId).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });
  });

  describe('compactWithLLM result', () => {
    it('returns promptEstimate after compression', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const { visible: bVisible, compactedTurnIds: bCompacted } = filterForContext(
          readHistory(fx.transcriptPath)
        );
        const before = estimateTokens(buildContextMessages(bVisible, bCompacted));
        const llm = makeMockLLM(
          '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
        );
        const ctx = await getCtxService();
        const result = await ctx.compactWithLLM(fx.transcriptPath, llm.modelInfo.maxTokens, llm);
        expect(result.didCompress).toBe(true);
        expect(result.promptEstimate).toBeGreaterThan(0);
        expect(result.promptEstimate).toBeLessThan(before);
        expect(result.released).toBeGreaterThan(0);
      } finally {
        cleanup(fx.slug);
      }
    });
  });

  describe('assemblePayload compaction', () => {
    const SUMMARY =
      '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne';

    it('folds history into a compacted summary message when it exceeds the window', async () => {
      const fx = makeFixture({ numTurns: 3, toolContentSize: 8000 });
      try {
        const ctx = await getCtxService();
        const messages = await ctx.assemblePayload(fx.transcriptPath, 1000, makeMockLLM(SUMMARY));
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.name === 'compacted_history')).toBe(true);
      } finally {
        cleanup(fx.slug);
      }
    });

    it('leaves history uncompacted when it fits the window', async () => {
      const fx = makeFixture({ numTurns: 2, toolContentSize: 20 });
      try {
        const ctx = await getCtxService();
        const messages = await ctx.assemblePayload(
          fx.transcriptPath,
          2_000_000,
          makeMockLLM(SUMMARY)
        );
        expect(messages.some((m) => m.name === 'compacted_history')).toBe(false);
      } finally {
        cleanup(fx.slug);
      }
    });
  });
});
