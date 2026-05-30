import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { initWorkspace, getWorkspaceCwd } from '../../../../src/core/workspace.js';
import { readFileTool } from '../../../../src/tools/domains/fs/read.js';
import { writeFileTool } from '../../../../src/tools/domains/fs/write.js';
import { editFileTool } from '../../../../src/tools/domains/fs/edit.js';
import { searchTool } from '../../../../src/tools/domains/fs/grep.js';
import { globTool } from '../../../../src/tools/domains/fs/glob.js';

describe('tools/domains/fs projectPath isolation', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    globalDir = join(tmpdir(), `global-${randomUUID().slice(0, 8)}`);
    projectDir = join(tmpdir(), `project-${randomUUID().slice(0, 8)}`);
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(globalDir, 'config'), { recursive: true });
    writeFileSync(join(globalDir, 'config', 'models.json'), '{"active":"p","providers":[]}', 'utf8');
    initWorkspace({ installRoot: globalDir, workspaceCwd: globalDir });
  });

  afterEach(() => {
    try { rmSync(globalDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const ctx = (cwd: string) => ({ projectPath: cwd });

  it('read_file uses ctx.projectPath over workspaceCwd', async () => {
    writeFileSync(join(projectDir, 'a.txt'), 'hello', 'utf8');
    const result = await readFileTool.execute(
      { path: 'a.txt', offset: 1, limit: 200 },
      ctx(projectDir),
    );
    expect(result).toContain('hello');
  });

  it('write_file writes to ctx.projectPath', async () => {
    await writeFileTool.execute(
      { path: 'b.txt', content: 'written' },
      ctx(projectDir),
    );
    expect(globalDir).not.toBe(projectDir);
    const written = readFileSync(join(projectDir, 'b.txt'), 'utf8');
    expect(written).toBe('written');
    expect(() => readFileSync(join(globalDir, 'b.txt'), 'utf8')).toThrow();
  });

  it('edit_file edits in ctx.projectPath', async () => {
    writeFileSync(join(projectDir, 'c.txt'), 'old', 'utf8');
    const result = await editFileTool.execute(
      { path: 'c.txt', old_string: 'old', new_string: 'new' },
      ctx(projectDir),
    );
    expect(result).toContain('1 replacement');
    expect(readFileSync(join(projectDir, 'c.txt'), 'utf8')).toBe('new');
  });

  it('search_code searches ctx.projectPath', async () => {
    writeFileSync(join(projectDir, 'd.txt'), 'needle', 'utf8');
    writeFileSync(join(globalDir, 'e.txt'), 'needle', 'utf8');
    const result = await searchTool.execute(
      { pattern: 'needle', glob: '*.txt', max_results: 30 },
      ctx(projectDir),
    );
    expect(result).toContain('d.txt');
    expect(result).not.toContain('e.txt');
  });

  it('search_files lists ctx.projectPath', async () => {
    writeFileSync(join(projectDir, 'f.ts'), '', 'utf8');
    writeFileSync(join(globalDir, 'g.ts'), '', 'utf8');
    const result = await globTool.execute(
      { pattern: '*.ts', path: '.', max_results: 50 },
      ctx(projectDir),
    );
    expect(result).toContain('f.ts');
    expect(result).not.toContain('g.ts');
  });

  it('falls back to workspaceCwd when ctx.projectPath is absent', async () => {
    writeFileSync(join(globalDir, 'h.txt'), 'fallback', 'utf8');
    const result = await readFileTool.execute({ path: 'h.txt', offset: 1, limit: 200 }, undefined);
    expect(result).toContain('fallback');
  });
});
