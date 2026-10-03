import { describe, it, expect } from 'vitest';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

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

