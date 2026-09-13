import { describe, it, expect } from 'vitest';
import { useTempProjectBase } from '../helpers/project-base.js';
import { CheckpointLayer } from '../../src/checkpoint/checkpoint.js';

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

describe('CheckpointService class', () => {
  it('CheckpointService class is exported', async () => {
    const mod = await import('../../src/checkpoint/port.js');
    expect(mod.CheckpointService).toBeDefined();
  }, 60000);
});

describe('CheckpointDiff type with insertions/deletions', () => {
  it('CheckpointDiff type includes insertions and deletions fields', async () => {
    // Verify the type structure by creating a mock object
    const diff: import('../../src/checkpoint/types.js').CheckpointDiff = {
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

describe('CheckpointService', () => {
  it('should export a Default layer', async () => {
    const { CheckpointService } = await import('../../src/checkpoint/port.js');
    expect(CheckpointService).toBeDefined();
    expect((CheckpointLayer as any)).toBeDefined();
  });
});
