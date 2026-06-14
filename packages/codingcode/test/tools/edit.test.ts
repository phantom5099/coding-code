import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { editFileTool } from '../../src/tools/domains/fs/edit.js';
import { writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const testFile = join(tmpdir(), 'coding-agent-edit-test-' + Date.now() + '.txt');

const initialContent = `line one
line two
line three
line two
line four`;

beforeEach(async () => {
  await writeFile(testFile, initialContent);
});

afterEach(async () => {
  await rm(testFile, { force: true });
});

describe('editFileTool', () => {
  it('should replace a unique string', async () => {
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'line three',
        new_string: 'line THREE',
      }) as any
    );
    expect(result).toContain('1 replacement made');
    const content = await readFile(testFile, 'utf-8');
    expect(content).toContain('line THREE');
    expect(content).not.toContain('line three');
  });

  it('should replace content at the beginning', async () => {
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'line one',
        new_string: 'LINE ONE',
      }) as any
    );
    expect(result).toContain('1 replacement made');
    const content = await readFile(testFile, 'utf-8');
    expect(content).toContain('LINE ONE');
  });

  it('should replace content at the end', async () => {
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'line four',
        new_string: 'LINE FOUR',
      }) as any
    );
    expect(result).toContain('1 replacement made');
    const content = await readFile(testFile, 'utf-8');
    expect(content).toContain('LINE FOUR');
  });

  it('should reject when old_string appears multiple times', async () => {
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'line two',
        new_string: 'LINE TWO',
      }) as any
    );
    expect(result).toContain('Error');
    expect(result).toContain('appears 2 times');
  });

  it('should reject when old_string is not found', async () => {
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'nonexistent text',
        new_string: 'replacement',
      })
    );
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('should make unique by including surrounding context', async () => {
    // "line one\nline two" is unique even though "line two" appears twice
    const result = await Effect.runPromise(
      editFileTool.execute({
        path: testFile,
        old_string: 'line one\nline two',
        new_string: 'LINE ONE\nLINE TWO',
      })
    );
    expect(result).toContain('1 replacement made');
    const content = await readFile(testFile, 'utf-8');
    expect(content).toContain('LINE ONE\nLINE TWO');
    // The second "line two" should still exist
    expect(content).toContain('line three\nline two');
  });
});
