import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SessionService — readHistoryFile rename', () => {
  it('exposes readHistoryFile method (not readHistory)', () => {
    const svc = SessionService.makeSync();
    expect(typeof svc.readHistoryFile).toBe('function');
    expect((svc as any).readHistory).toBeUndefined();
  });
});

describe('SessionService — closure-local io functions', () => {
  const testDir = join(tmpdir(), 'session-service-closure-test');

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('readHistoryFile reads a jsonl file and returns parsed events', () => {
    const svc = SessionService.makeSync();
    const filePath = join(testDir, 'test.jsonl');
    const event = { type: 'user', content: 'hello', turnId: 1, uuid: 'u1', timestamp: new Date().toISOString() };
    writeFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');

    const events = svc.readHistoryFile(filePath);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('user');
    expect((events[0] as any).content).toBe('hello');
  });

  it('readHistoryFile returns empty array for non-existent file', () => {
    const svc = SessionService.makeSync();
    const events = svc.readHistoryFile(join(testDir, 'nonexistent.jsonl'));
    expect(events).toEqual([]);
  });

  it('appendLine appends a JSON line to a file', () => {
    const svc = SessionService.makeSync();
    const filePath = join(testDir, 'append-test.jsonl');
    svc.appendLine(filePath, { type: 'user', content: 'hi' });
    svc.appendLine(filePath, { type: 'assistant', content: 'there' });

    const events = svc.readHistoryFile(filePath);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('user');
    expect(events[1]!.type).toBe('assistant');
  });

  it('truncateTitle truncates long content', () => {
    const svc = SessionService.makeSync();
    const longContent = 'a'.repeat(50);
    const result = svc.truncateTitle(longContent);
    expect(result.length).toBeLessThanOrEqual(33); // 30 chars + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncateTitle keeps short content as-is', () => {
    const svc = SessionService.makeSync();
    const shortContent = 'hello';
    const result = svc.truncateTitle(shortContent);
    expect(result).toBe('hello');
  });

  it('countNonMetaEvents counts only non-meta events', () => {
    const svc = SessionService.makeSync();
    const events = [
      { type: 'session_meta', sessionId: 's1' },
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'there' },
    ];
    expect(svc.countNonMetaEvents(events as any)).toBe(2);
  });

  it('findFirstUserContent returns first user content', () => {
    const svc = SessionService.makeSync();
    const events = [
      { type: 'session_meta', sessionId: 's1' },
      { type: 'user', content: 'first question' },
      { type: 'assistant', content: 'answer' },
      { type: 'user', content: 'second question' },
    ];
    expect(svc.findFirstUserContent(events as any)).toBe('first question');
  });

  it('findFirstUserContent returns null when no user events', () => {
    const svc = SessionService.makeSync();
    const events = [
      { type: 'session_meta', sessionId: 's1' },
      { type: 'assistant', content: 'answer' },
    ];
    expect(svc.findFirstUserContent(events as any)).toBeNull();
  });

  it('projectSessionsDir returns correct path', () => {
    const svc = SessionService.makeSync();
    const result = svc.projectSessionsDir('encoded-project');
    expect(result).toContain('project');
    expect(result).toContain('encoded-project');
    expect(result).toContain('sessions');
  });

  it('readCurrentIndex returns null for non-existent file', () => {
    const svc = SessionService.makeSync();
    const result = svc.readCurrentIndex(join(testDir, 'nonexistent.index.json'));
    expect(result).toBeNull();
  });

  it('readCurrentIndex reads an existing index file', () => {
    const svc = SessionService.makeSync();
    const indexPath = join(testDir, 'test.index.json');
    const index = { sessionId: 's1', messageCount: 5 };
    writeFileSync(indexPath, JSON.stringify(index), 'utf8');

    const result = svc.readCurrentIndex(indexPath);
    expect(result).not.toBeNull();
    expect((result as any)!.sessionId).toBe('s1');
    expect((result as any)!.messageCount).toBe(5);
  });
});

describe('SessionService — writeQueues inside closure', () => {
  it('enqueueWrite writes data asynchronously', async () => {
    const svc = SessionService.makeSync();
    const testDir = join(tmpdir(), 'session-enqueue-test');
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const indexPath = join(testDir, 'test.index.json');
    svc.enqueueWrite('test-session', indexPath, { sessionId: 'test-session', messageCount: 3 });

    // Wait for async write
    await new Promise((r) => setTimeout(r, 100));

    const result = svc.readCurrentIndex(indexPath);
    expect(result).not.toBeNull();
    expect((result as any)!.sessionId).toBe('test-session');

    rmSync(testDir, { recursive: true, force: true });
  });
});
