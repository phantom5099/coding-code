import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { assemblePayload } from '../../src/context/organizer.js';
import type { SessionEvent } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeConfig() {
  return {
    microCompactThreshold: 0.5,
    microCompactMinChars: 120,
    compactionThreshold: 0.9,
    keepRecentTurns: 1,
    compactionModel: '',
    reactiveCompactMaxRetries: 3,
  };
}

describe('assemblePayload integration', () => {
  const projectSlug = randomUUID();
  let sessionId: string;
  let sessionDir: string;
  let jsonlPath: string;
  let indexPath: string;

  beforeEach(() => {
    sessionId = randomUUID();
    sessionDir = join(PROJECT_BASE, projectSlug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    jsonlPath = join(sessionDir, `${sessionId}.jsonl`);
    indexPath = join(sessionDir, `${sessionId}.index.json`);

    const lines: any[] = [
      {
        type: 'session_meta',
        sessionId,
        projectPath: projectSlug,
        cwd: '/tmp/test',
        model: 'test',
        createdAt: new Date().toISOString(),
      },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'q1', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'r1',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'x'.repeat(200),
        timestamp: new Date().toISOString(),
        tokenCount: 0,
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 't2',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc2',
        output: 'y'.repeat(200),
        timestamp: new Date().toISOString(),
        tokenCount: 0,
      },
    ];
    writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const idx = {
      sessionId,
      projectPath: projectSlug,
      cwd: '/tmp/test',
      model: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: lines.length,
      title: 'fixture',
      currentTurnId: 1,
      usage: undefined,
      promptEstimate: 0,
      permissionMode: 'default',
    };
    writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');
  });

  afterEach(() => {
    const dir = join(PROJECT_BASE, projectSlug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns messages and compactedEvents', () => {
    const config = makeConfig();
    const result = assemblePayload(sessionId, projectSlug, config);

    expect(result.messages.length).toBeGreaterThan(0);
    expect(Array.isArray(result.compactedEvents)).toBe(true);
    expect(result.currentTurnId).toBe(1);
    expect(result.promptEstimate).toBeGreaterThan(0);
  });

  it('returns currentTurnId from session index', () => {
    const config = makeConfig();
    const result = assemblePayload(sessionId, projectSlug, config);
    expect(result.currentTurnId).toBe(1);
  });
});
