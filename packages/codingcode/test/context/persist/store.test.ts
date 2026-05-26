import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { persistToolResult } from '../../../src/context/persist/store.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');
const TEST_ENCODED = 'test-project-persist';
const TEST_SESSION = 'test-session-123';
const TEST_TOOL_CALL = 'call-456';

describe('persistToolResult', () => {
  afterEach(() => {
    const dir = join(PROJECT_BASE, TEST_ENCODED, 'tool-results');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates directory structure and persists content', () => {
    const content = 'This is a long tool output\nLine 2\nLine 3';
    const result = persistToolResult(TEST_ENCODED, TEST_SESSION, TEST_TOOL_CALL, content);

    const expectedPath = join(PROJECT_BASE, TEST_ENCODED, 'tool-results', TEST_SESSION, `${TEST_TOOL_CALL}.txt`).replace(/\\/g, '/');
    expect(result.path).toBe(expectedPath);
    expect(result.bytes).toBe(Buffer.byteLength(content, 'utf8'));
    expect(existsSync(result.path.replace(/\//g, '\\'))).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toBe(content);
  });

  it('is idempotent — skips write if file already exists', () => {
    const content = 'Original content';
    const result1 = persistToolResult(TEST_ENCODED, TEST_SESSION, TEST_TOOL_CALL, content);

    const modifiedContent = 'Modified content';
    const result2 = persistToolResult(TEST_ENCODED, TEST_SESSION, TEST_TOOL_CALL, modifiedContent);

    expect(readFileSync(result1.path, 'utf8')).toBe(content);
    expect(result1.path).toBe(result2.path);
  });

  it('returns absolute path under PROJECT_BASE', () => {
    const result = persistToolResult(TEST_ENCODED, TEST_SESSION, 'tool-call-xyz', 'content');
    expect(result.path).toContain('.codingcode/project');
    expect(result.path).toContain(TEST_ENCODED);
    expect(result.path).toContain('tool-results');
  });

  it('handles multiple tool calls in same session', () => {
    const call1 = persistToolResult(TEST_ENCODED, TEST_SESSION, 'call-1', 'content1');
    const call2 = persistToolResult(TEST_ENCODED, TEST_SESSION, 'call-2', 'content2');

    expect(call1.path).toContain('call-1.txt');
    expect(call2.path).toContain('call-2.txt');
    expect(readFileSync(call1.path, 'utf8')).toBe('content1');
    expect(readFileSync(call2.path, 'utf8')).toBe('content2');
  });
});
