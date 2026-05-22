import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { persistToolResult } from '../../../src/context/persist/store.js';

const TEST_CWD = '/tmp/persist-store-test';
const TEST_SESSION = 'test-session-123';
const TEST_TOOL_CALL = 'call-456';

describe('persistToolResult', () => {
  beforeEach(() => {
    if (existsSync(TEST_CWD)) rmSync(TEST_CWD, { recursive: true, force: true });
    mkdirSync(TEST_CWD, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CWD)) rmSync(TEST_CWD, { recursive: true, force: true });
  });

  it('should create directory structure and persist content', () => {
    const content = 'This is a long tool output\nLine 2\nLine 3';
    const result = persistToolResult(TEST_SESSION, TEST_TOOL_CALL, content, TEST_CWD);

    expect(result.path).toBe(`.codingcode/tool-results/${TEST_SESSION}/${TEST_TOOL_CALL}.txt`);
    expect(result.bytes).toBe(Buffer.byteLength(content, 'utf8'));

    const filePath = join(TEST_CWD, result.path);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(content);
  });

  it('should be idempotent - skip write if file exists', () => {
    const content = 'Original content';
    const result1 = persistToolResult(TEST_SESSION, TEST_TOOL_CALL, content, TEST_CWD);

    const modifiedContent = 'Modified content';
    const result2 = persistToolResult(TEST_SESSION, TEST_TOOL_CALL, modifiedContent, TEST_CWD);

    const filePath = join(TEST_CWD, result1.path);
    const actualContent = readFileSync(filePath, 'utf8');
    expect(actualContent).toBe(content); // Original, not modified
    expect(result1.path).toBe(result2.path);
  });

  it('should return relative path from cwd', () => {
    const result = persistToolResult(TEST_SESSION, 'tool-call-xyz', 'content', TEST_CWD);
    expect(result.path).toMatch(/^\.codingcode\/tool-results\//);
    expect(result.path).not.toMatch(/^\/|^[a-z]:/i); // No absolute path
  });

  it('should handle multiple tool calls in same session', () => {
    const call1 = persistToolResult(TEST_SESSION, 'call-1', 'content1', TEST_CWD);
    const call2 = persistToolResult(TEST_SESSION, 'call-2', 'content2', TEST_CWD);

    expect(call1.path).toContain('call-1.txt');
    expect(call2.path).toContain('call-2.txt');

    const file1 = readFileSync(join(TEST_CWD, call1.path), 'utf8');
    const file2 = readFileSync(join(TEST_CWD, call2.path), 'utf8');
    expect(file1).toBe('content1');
    expect(file2).toBe('content2');
  });
});
