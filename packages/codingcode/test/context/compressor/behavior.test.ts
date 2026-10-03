import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../../src/context/port.js';
import type { ContextShape } from '../../../src/context/port.js';
import { SessionService } from '../../../src/session/port.js';
import { SessionLayer } from '../../../src/session/session.js';
import { LLMService } from '../../../src/llm/port.js';
import type { SessionEvent, SessionRef, SummaryEvent } from '../../../src/contracts/session.js';
import { filterForContext, buildContextMessages, transcriptPathFor } from '../../../src/context/context.js';
import { readHistory } from '../../../src/session/file-ops.js';
import { estimateTokens } from '../../../src/context/tokens.js';
import { useTempProjectBase } from '../../helpers/project-base.js';
import { ContextLayer } from '../../../src/context/context.js';

// 上下文窗口现在由 catalog 按模型值现取，测试里钉死成一个可控值
const windowState = vi.hoisted(() => ({ value: 128000 }));
vi.mock('../../../src/infra/models.js', () => ({
  contextWindowOf: () => windowState.value,
}));

useTempProjectBase();

interface FixtureOptions {
  numTurns: number;
  toolContentSize?: number;
  toolName?: string;
}

const CWD = '/tmp/test';

function makeFixture(opts: FixtureOptions) {
  const sessionId = randomUUID();
  const ref: SessionRef = { cwd: CWD, sessionId };
  const transcriptPath = transcriptPathFor(ref);
  mkdirSync(dirname(transcriptPath), { recursive: true });

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      cwd: CWD,
      createdAt: new Date().toISOString(),
      model: 'test-model',
      title: 'fixture',
      activeProfile: 'build',
      permissionMode: 'ask',
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

  return { ref, sessionId, dir: dirname(transcriptPath), transcriptPath };
}

function cleanup(dir: string) {
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

function makeMockLLM(content: string) {
  return {
    complete: () => Effect.succeed({ content }),
    completeStream: () =>
      (async function* () {
        yield { type: 'text' as const, text: content };
        yield { type: 'end' as const };
      })(),
  } as any;
}

const FailingLLM = {
  complete: () => Effect.fail(new Error('no llm')),
  completeStream: () => (async function* () {})(),
} as any;

function makeTestLayer(llm: unknown) {
  return Layer.merge(SessionLayer, Layer.succeed(LLMService, llm as any));
}

async function getCtxService(llm: unknown): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(makeTestLayer(llm)))
  );
}

/** ContextShape 现在返回 Effect，测试统一用 runPromise 驱动 */
const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff);

describe('compressor behavior', () => {
  describe('L5 compaction', () => {
    it('writes summary event with five-section system summary', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        const summary =
          '## Compacted History\n\n### Goal\nfix bug\n\n### Instructions\nbe careful\n\n### Discoveries\nrace condition\n\n### Accomplished\npatched\n\n### Relevant Files\nsrc/x.ts';
        windowState.value = 1000;
        const ctx = await getCtxService(makeMockLLM(summary));
        await run(ctx.compactWithLLM(fx.ref, 'test-model'));
        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries.length).toBe(1);
        expect(summaries[0]!.summaryText).toContain('### Goal');
        expect(summaries[0]!.startTurnId).toBeLessThanOrEqual(summaries[0]!.endTurnId);
        expect(summaries[0]!.endTurnId).toBeGreaterThan(0);
      } finally {
        cleanup(fx.dir);
      }
    });

    it('returns no-op when no LLM available', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        windowState.value = 1000;
        const ctx = await getCtxService(FailingLLM);
        const result = await run(ctx.compactWithLLM(fx.ref, 'test-model'));
        expect(result.didCompress).toBe(false);
        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries).toHaveLength(0);
      } finally {
        cleanup(fx.dir);
      }
    });
  });

  describe('summary events update JSONL', () => {
    it('appends summary event directly to JSONL after L5', async () => {
      const fx = makeFixture({ numTurns: 5 });
      try {
        windowState.value = 1000;
        const ctx = await getCtxService(
          makeMockLLM(
            '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
          )
        );
        await run(ctx.compactWithLLM(fx.ref, 'test-model'));

        const summaries = readSummaryEvents(fx.transcriptPath);
        expect(summaries).toHaveLength(1);
        expect(summaries[0]!.startTurnId).toBeLessThanOrEqual(summaries[0]!.endTurnId);
        expect(summaries[0]!.endTurnId).toBeGreaterThan(0);
      } finally {
        cleanup(fx.dir);
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
        windowState.value = 1000;
        const ctx = await getCtxService(
          makeMockLLM(
            '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne'
          )
        );
        const result = await run(ctx.compactWithLLM(fx.ref, 'test-model'));
        expect(result.didCompress).toBe(true);
        expect(result.promptEstimate).toBeGreaterThan(0);
        expect(result.promptEstimate).toBeLessThan(before);
        expect(result.released).toBeGreaterThan(0);
      } finally {
        cleanup(fx.dir);
      }
    });
  });

  describe('assemblePayload compaction', () => {
    const SUMMARY =
      '## Compacted History\n\n### Goal\na\n\n### Instructions\nb\n\n### Discoveries\nc\n\n### Accomplished\nd\n\n### Relevant Files\ne';

    it('folds history into a compacted summary message when it exceeds the window', async () => {
      const fx = makeFixture({ numTurns: 3, toolContentSize: 8000 });
      try {
        windowState.value = 1000;
        const ctx = await getCtxService(makeMockLLM(SUMMARY));
        const messages = await run(ctx.assemblePayload(fx.ref, 'test-model'));
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.name === 'compacted_history')).toBe(true);
      } finally {
        cleanup(fx.dir);
      }
    });

    it('leaves history uncompacted when it fits the window', async () => {
      const fx = makeFixture({ numTurns: 2, toolContentSize: 20 });
      try {
        windowState.value = 2_000_000;
        const ctx = await getCtxService(makeMockLLM(SUMMARY));
        const messages = await run(ctx.assemblePayload(fx.ref, 'test-model'));
        expect(messages.some((m) => m.name === 'compacted_history')).toBe(false);
      } finally {
        cleanup(fx.dir);
      }
    });
  });
});
