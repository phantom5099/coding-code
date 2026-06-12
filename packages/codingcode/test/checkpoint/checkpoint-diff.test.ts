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
  spawnSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: projectPath,
    encoding: 'utf-8',
  });

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

describe('toGitPath', () => {
  it('converts absolute to relative', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');
    const result = toGitPath('/tmp/project', '/tmp/project/src/file.ts');
    expect(result).toBe('src/file.ts');
  });

  it('returns normalized path when not under project', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');
    const result = toGitPath('/tmp/project', '/other/file.ts');
    expect(result).toContain('file.ts');
  });
});

describe('CheckpointService class', () => {
  it('CheckpointService class is exported', async () => {
    const mod = await import('../../src/checkpoint/checkpoint-service.js');
    expect(mod.CheckpointService).toBeDefined();
  });
});

describe('CheckpointDiff type with insertions/deletions', () => {
  it('CheckpointDiff type includes insertions and deletions fields', async () => {
    // Verify the type structure by creating a mock object
    const diff: import('../../src/checkpoint/checkpoint-service.js').CheckpointDiff = {
      turnId: 1,
      files: [
        {
          path: 'test.ts',
          status: 'M',
          diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
          insertions: 1,
          deletions: 1,
        },
      ],
    };
    expect(diff.files[0]!.insertions).toBe(1);
    expect(diff.files[0]!.deletions).toBe(1);
  });
});

describe('ShadowGit commit and findCommitByMessage flow', () => {
  it('creates commits that can be found by message pattern', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const projectPath = setupTempRepo().projectPath;

    try {
      writeFile(projectPath, 'src/main.ts', 'console.log("hello")');

      const sg = new ShadowGit(projectPath);
      sg.init();

      // First commit (baseline)
      const baselineMsg = 'turn-abc123-1-baseline';
      sg.commit(baselineMsg);

      // Modify file
      writeFile(projectPath, 'src/main.ts', 'console.log("world")');

      // Second commit (final)
      const finalMsg = 'turn-abc123-1-final';
      sg.commit(finalMsg);

      // Verify commits can be found
      const baselineHash = sg.findCommitByMessage(baselineMsg);
      const finalHash = sg.findCommitByMessage(finalMsg);

      expect(baselineHash).not.toBeNull();
      expect(finalHash).not.toBeNull();
      expect(baselineHash).not.toBe(finalHash);

      // Verify diff between commits
      const changes = sg.diffFiles(baselineHash!, finalHash!);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]!.file).toContain('main.ts');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);

  it('returns empty diff when no changes between commits', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const projectPath = setupTempRepo().projectPath;

    try {
      writeFile(projectPath, 'src/main.ts', 'console.log("hello")');

      const sg = new ShadowGit(projectPath);
      sg.init();

      const msg1 = 'turn-abc123-1-baseline';
      sg.commit(msg1);

      // No file changes
      const msg2 = 'turn-abc123-1-final';
      sg.commit(msg2);

      const hash1 = sg.findCommitByMessage(msg1);
      const hash2 = sg.findCommitByMessage(msg2);

      expect(hash1).not.toBeNull();
      expect(hash2).not.toBeNull();

      const changes = sg.diffFiles(hash1!, hash2!);
      expect(changes.length).toBe(0);
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);

  it('correctly handles Chinese filenames in commits and diffs', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const projectPath = setupTempRepo().projectPath;

    try {
      writeFile(
        projectPath,
        '\u8d5e\u988c\u7956\u56fd\u4eba_\u7b2c\u4e00\u7bc7.md',
        'initial content'
      );

      const sg = new ShadowGit(projectPath);
      sg.init();

      const baselineMsg = 'turn-cn-test-1-baseline';
      sg.commit(baselineMsg);

      writeFile(
        projectPath,
        '\u8d5e\u988c\u7956\u56fd\u4eba_\u7b2c\u4e00\u7bc7.md',
        'modified content'
      );

      const finalMsg = 'turn-cn-test-1-final';
      sg.commit(finalMsg);

      const baselineHash = sg.findCommitByMessage(baselineMsg);
      const finalHash = sg.findCommitByMessage(finalMsg);

      expect(baselineHash).not.toBeNull();
      expect(finalHash).not.toBeNull();
      expect(baselineHash).not.toBe(finalHash);

      // Verify the diff actually detects the file change (non-empty tree)
      const changes = sg.diffFiles(baselineHash!, finalHash!);
      expect(changes.length).toBe(1);
      expect(changes[0]!.file).toContain('\u8d5e\u988c\u7956\u56fd\u4eba');
      expect(changes[0]!.status).toBe('M');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);

  it('throws when git add -A fails', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const projectPath = setupTempRepo().projectPath;

    try {
      writeFile(projectPath, 'normal.md', 'content');

      const sg = new ShadowGit(projectPath);
      sg.init();

      // Patch run() to simulate a failing add
      const originalRun = (sg as any).run.bind(sg);
      (sg as any).run = function (...args: string[]) {
        if (args[0] === 'add' && args[1] === '-A') {
          return { stdout: '', stderr: 'fatal: unable to add files', status: 128 };
        }
        return originalRun(...args);
      };

      expect(() => sg.commit('turn-fail-1-baseline')).toThrow('ShadowGit add failed');
    } finally {
      cleanupTempRepo(projectPath);
    }
  });
});

describe('CheckpointService', () => {
  it('should export a Default layer', async () => {
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    expect(CheckpointService).toBeDefined();
    expect((CheckpointService as any).Default).toBeDefined();
  });
});
