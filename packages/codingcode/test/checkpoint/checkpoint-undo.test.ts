import { describe, it, expect } from 'vitest';
import { useTempProjectBase } from '../helpers/project-base.js';
import { CheckpointLayer } from '../../src/checkpoint/checkpoint.js';

useTempProjectBase();

describe('toGitPath case-insensitive matching', () => {
  it('handles Windows case-mismatched projectPath and file path', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');

    // projectPath has mixed case (Users, Desktop), file path is all lowercase
    const projectPath = 'c:/Users/Alice/Desktop/MyProject';
    const filePath = 'c:/users/alice/desktop/myproject/src/file.ts';
    const result = toGitPath(projectPath, filePath);

    expect(result).toBe('src/file.ts');
  });

  it('handles lowercase projectPath with uppercase file path', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');

    const projectPath = 'c:/users/alice/desktop/myproject';
    const filePath = 'c:/Users/Alice/Desktop/MyProject/src/file.ts';
    const result = toGitPath(projectPath, filePath);

    expect(result).toBe('src/file.ts');
  });

  it('still returns normalized absolute path when file is outside project', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');

    const result = toGitPath('c:/Users/Alice/Desktop/MyProject', 'c:/other/file.ts');

    expect(result).toContain('other/file.ts');
  });
});

describe('toGitPath preserves original casing for git paths', () => {
  it('returns relative path with original casing from git diff', async () => {
    const { toGitPath } = await import('../../src/checkpoint/utils.js');

    // Simulate a path that git returns with original casing
    const projectPath = 'c:/Users/Alice/Desktop/MyProject';
    const gitPath = 'c:/Users/Alice/Desktop/MyProject/src/Main.ts';

    expect(toGitPath(projectPath, gitPath)).toBe('src/Main.ts');
  });
});

describe('CheckpointService', () => {
  it('should export a Default layer', async () => {
    const { CheckpointService } = await import('../../src/checkpoint/port.js');
    expect(CheckpointService).toBeDefined();
    expect((CheckpointLayer as any)).toBeDefined();
  });
});
