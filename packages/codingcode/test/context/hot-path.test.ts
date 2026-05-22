import { describe, it, expect, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { ContextService } from '../../src/context/context.js';
import { appendProjection } from '../../src/session/projection-store.js';
import type { SessionIndex } from '../../src/session/types.js';

const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions');

const ContextLayer = ContextService.Default;

function buildFixture(opts: { numTurns: number; toolSize?: number }) {
  const sessionId = randomUUID();
  const slug = randomUUID();
  const dir = join(SESSIONS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
  ];

  const toolContent = 'Y'.repeat(opts.toolSize ?? 200);
  for (let turn = 1; turn <= opts.numTurns; turn++) {
    lines.push({ type: 'user', turnId: turn, uuid: `u${turn}`, content: `q${turn}`, timestamp: new Date().toISOString() });
    lines.push({ type: 'assistant', turnId: turn, uuid: `a${turn}`, content: `r${turn}`, toolCalls: [{ id: `tc${turn}`, name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() });
    lines.push({ type: 'tool_result', turnId: turn, uuid: `t${turn}`, parentUuid: `a${turn}`, toolName: 'bash', toolCallId: `tc${turn}`, output: toolContent, timestamp: new Date().toISOString(), tokenCount: Math.ceil(toolContent.length / 3.5) });
  }
  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectSlug: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: opts.numTurns * 3, title: 'fix', currentTurnId: opts.numTurns,
    tokenCountEstimate: 0, projectedRanges: [], lastUncoveredByteOffset: 0,
    projectionCount: 0, lastCompressionFailures: 0,
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { sessionId, dir, indexPath };
}

function cleanup(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe('ContextService.build hot path', () => {
  it('reads from JSONL via assemblePayload, ignoring in-memory log', async () => {
    const fx = buildFixture({ numTurns: 2 });
    try {
      const program = Effect.gen(function* () {
        const ctx = yield* ContextService;
        // Add a totally unrelated message to in-memory log
        yield* ctx.addUser(fx.sessionId, 'IN-MEMORY-ONLY');
        return yield* ctx.build(fx.sessionId);
      });
      const messages = await Effect.runPromise(program.pipe(Effect.provide(ContextLayer)));
      // build() must read from JSONL, not from the in-memory log
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toContain('q1');
      expect(userContents).toContain('q2');
      expect(userContents).not.toContain('IN-MEMORY-ONLY');
    } finally { cleanup(fx.dir); }
  });

  it('applies MessageProjection so LLM view sees replacement, not raw output', async () => {
    const fx = buildFixture({ numTurns: 3, toolSize: 500 });
    try {
      // Manually inject a prune projection on tool t2
      appendProjection(fx.sessionId, {
        type: 'message',
        id: 'proj-1',
        targetEventUuid: 't2',
        replacement: { role: 'tool', content: '[Old tool result content cleared]', tool_call_id: 'tc2' },
        originalTurnId: 2,
        method: 'prune',
        createdAt: new Date().toISOString(),
      });

      const program = Effect.gen(function* () {
        const ctx = yield* ContextService;
        return yield* ctx.build(fx.sessionId);
      });
      const messages = await Effect.runPromise(program.pipe(Effect.provide(ContextLayer)));
      const toolMsgs = messages.filter((m) => m.role === 'tool');
      const t2 = toolMsgs.find((m) => m.tool_call_id === 'tc2');
      expect(t2).toBeDefined();
      expect(t2!.content).toBe('[Old tool result content cleared]');
    } finally { cleanup(fx.dir); }
  });

  it('appendTurnEnd is a no-op when usage is below threshold', async () => {
    const fx = buildFixture({ numTurns: 1, toolSize: 100 });
    try {
      const program = Effect.gen(function* () {
        const ctx = yield* ContextService;
        return yield* ctx.appendTurnEnd(fx.sessionId, null);
      });
      const result = await Effect.runPromise(program.pipe(Effect.provide(ContextLayer)));
      expect(result.didCompress).toBe(false);
    } finally { cleanup(fx.dir); }
  });
});
