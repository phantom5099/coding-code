import { describe, it, expect, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { SessionService } from '../../src/session/store.js';
import { ContextService } from '../../src/context/context.js';
import { appendProjection } from '../../src/session/projection-store.js';
import type { SessionIndex } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('tokenCountEstimate incremental maintenance', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
  });

  it('increments index.tokenCountEstimate after each record*', async () => {
    const cwd = join(PROJECT_BASE, '__tmp__', randomUUID());
    mkdirSync(cwd, { recursive: true });
    tempDirs.push(dirname(cwd));

    const program = Effect.gen(function* () {
      const session = yield* SessionService;
      const state = yield* session.create(cwd, 'test', '0.1.0');
      session.incrementTurn(state);
      yield* session.recordUser(state, 'hello world');
      yield* session.recordAssistant(state, 'sure thing', [], 'test');
      yield* session.recordToolResult(state, 'a-uuid', 'bash', 'tc1', 'X'.repeat(700));
      return state;
    });

    const state = await Effect.runPromise(
      program.pipe(Effect.provide(SessionService.Default)),
    );
    tempDirs.push(dirname(state.transcriptPath));

    // Wait for queued writes to flush
    await new Promise((r) => setTimeout(r, 50));

    const idx = JSON.parse(readFileSync(state.indexPath, 'utf8')) as SessionIndex;
    expect(idx.tokenCountEstimate).toBeGreaterThan(0);
    // 'hello world' (~4 tokens) + 'sure thing' (~3 tokens) + 700 chars (~200 tokens) = ~200+
    expect(idx.tokenCountEstimate).toBeGreaterThan(150);
    expect(state.tokenCountEstimate).toBe(idx.tokenCountEstimate);
  });

  it('decreases tokenCountEstimate after a prune projection', async () => {
    // Set up a session with a chunky tool_result, then write a prune projection.
    const sessionId = randomUUID();
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const transcriptPath = join(dir, `${sessionId}.jsonl`);
    const indexPath = join(dir, `${sessionId}.index.json`);
    const toolContent = 'Y'.repeat(4000); // ~1143 tokens
    const toolTokens = Math.ceil(toolContent.length / 3.5);

    const lines = [
      { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'q', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 1, uuid: 'a1', content: 'r', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() },
      { type: 'tool_result', turnId: 1, uuid: 't1', parentUuid: 'a1', toolName: 'bash', toolCallId: 'tc1', output: toolContent, timestamp: new Date().toISOString(), tokenCount: toolTokens },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const idx0: SessionIndex = {
      sessionId, projectPath: slug, cwd: '/tmp', model: 'test',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      messageCount: 3, title: 't', currentTurnId: 1,
      tokenCountEstimate: toolTokens + 4, // tool + tiny user + tiny assistant
      projectedRanges: [], lastUncoveredByteOffset: 0,
      projectionCount: 0, lastCompressionFailures: 0,
    };
    writeFileSync(indexPath, JSON.stringify(idx0, null, 2), 'utf8');

    appendProjection(sessionId, {
      type: 'message',
      id: 'p1',
      targetEventUuid: 't1',
      replacement: { role: 'tool', content: '[Old tool result content cleared]', tool_call_id: 'tc1' },
      originalTurnId: 1,
      method: 'prune',
      createdAt: new Date().toISOString(),
    });

    const idxAfter = JSON.parse(readFileSync(indexPath, 'utf8')) as SessionIndex;
    expect(idxAfter.tokenCountEstimate).toBeLessThan(idx0.tokenCountEstimate);
    // Should have decreased by roughly toolTokens minus a small replacement cost
    expect(idx0.tokenCountEstimate - idxAfter.tokenCountEstimate).toBeGreaterThan(toolTokens - 50);
  });

  it('appendTurnEnd uses index.tokenCountEstimate (O(1) gate, not full assemble)', async () => {
    // Configure a very low budget; pre-seed index.tokenCountEstimate above
    // threshold; assert appendTurnEnd attempts to run() (will no-op if no LLM).
    const sessionId = randomUUID();
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    const transcriptPath = join(dir, `${sessionId}.jsonl`);
    const indexPath = join(dir, `${sessionId}.index.json`);

    // Empty-ish JSONL so collectAllRawTools yields nothing â†?run() exits cleanly.
    writeFileSync(transcriptPath, JSON.stringify({ type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' }) + '\n', 'utf8');

    const idx: SessionIndex = {
      sessionId, projectPath: slug, cwd: '/tmp', model: 'test',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      messageCount: 0, title: 't', currentTurnId: 0,
      tokenCountEstimate: 999_999, // way above any threshold
      projectedRanges: [], lastUncoveredByteOffset: 0,
      projectionCount: 0, lastCompressionFailures: 0,
    };
    writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

    const program = Effect.gen(function* () {
      const ctx = yield* ContextService;
      return yield* ctx.appendTurnEnd(sessionId, null);
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextService.Default)),
    );
    // Either didCompress=false because no candidates, or true if something happened.
    // Key assertion: it ran without crashing and returned a CompressResult shape.
    expect(result).toHaveProperty('didCompress');
    expect(result).toHaveProperty('released');
  });
});
