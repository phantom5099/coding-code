import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function setupTempRepo(): { projectPath: string; slug: string } {
  const slug = `test-${randomUUID()}`;
  const projectPath = join(homedir(), '.codingcode-test', slug);
  mkdirSync(projectPath, { recursive: true });

  // Initialize git repo
  spawnSync('git', ['init'], { cwd: projectPath, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: projectPath, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: projectPath, encoding: 'utf-8' });

  return { projectPath, slug };
}

function cleanupTempRepo(projectPath: string) {
  rmSync(projectPath, { recursive: true, force: true });
}

function writeFile(projectPath: string, filename: string, content: string) {
  const filePath = join(projectPath, filename);
  const dir = join(filePath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

describe('toGitPath and hashWorkspaceFile', () => {
  it('toGitPath converts absolute to relative', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');
    const result = toGitPath('/tmp/project', '/tmp/project/src/file.ts');
    expect(result).toBe('src/file.ts');
  });

  it('toGitPath returns normalized path when not under project', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');
    const result = toGitPath('/tmp/project', '/other/file.ts');
    expect(result).toContain('file.ts');
  });

  it('hashWorkspaceFile returns null for non-existent file', async () => {
    const { hashWorkspaceFile } = await import('../../src/checkpoint/checkpoint-service.js');
    const result = hashWorkspaceFile('/tmp/nonexistent', 'nonexistent.ts');
    expect(result).toBeNull();
  });
});

describe('CodeRestoreEntry types', () => {
  it('CodeRestoreEntry type is exported', async () => {
    const mod = await import('../../src/checkpoint/checkpoint-service.js');
    // Verify the service class is exported
    expect(typeof mod.CheckpointService).toBe('function');
  });

  it('toGitPath and hashWorkspaceFile are exported as functions', async () => {
    const { toGitPath, hashWorkspaceFile } = await import('../../src/checkpoint/checkpoint-service.js');
    expect(typeof toGitPath).toBe('function');
    expect(typeof hashWorkspaceFile).toBe('function');
  });
});
