import { describe, it, expect, beforeEach } from 'vitest';
import { useRollbackStore } from '../src/stores/rollback.store';

describe('Rollback state in global store', () => {
  beforeEach(() => {
    // Reset the store state
    useRollbackStore.setState({
      rollbackStateByThreadId: {},
      checkpointDiffByTurnId: {},
      revertedFilesByTurnId: {},
      turnCheckpointMapping: {},
    });
  });

  it('setRollbackState stores session rollback state', () => {
    const state = {
      context: { active: false, currentThroughTurnId: null },
      code: {
        canUndoLast: true,
        lastEntry: null,
        revertedFiles: ['/test/file.ts'],
        lastEntryId: 'entry1',
      },
    };
    useRollbackStore.getState().setRollbackState('thread1', state as any);

    const stored = useRollbackStore.getState().rollbackStateByThreadId['thread1'];
    expect(stored).toBeDefined();
    expect(stored!.code.revertedFiles).toEqual(['/test/file.ts']);
  });

  it('setCheckpointDiff stores diff by thread and turn', () => {
    const diff = {
      turnId: 3,
      files: [
        {
          path: '/test/a.ts',

          status: 'M',
          diff: '---\n+++\n',
          insertions: 2,
          deletions: 1,
        },
      ],
    };
    useRollbackStore.getState().setCheckpointDiff('thread1', '3', diff);

    const cached = useRollbackStore.getState().checkpointDiffByTurnId['thread1:3'];
    expect(cached).toBeDefined();
    expect(cached!.turnId).toBe(3);
    expect(cached!.files).toHaveLength(1);
    expect(cached!.files[0]!.insertions).toBe(2);
    expect(cached!.files[0]!.deletions).toBe(1);
  });

  it('markFileReverted adds file to reverted list', () => {
    useRollbackStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    const reverted = useRollbackStore.getState().revertedFilesByTurnId['thread1:3'];
    expect(reverted).toContain('/test/a.ts');
  });

  it('markFileReverted does not duplicate entries', () => {
    useRollbackStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    useRollbackStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    const reverted = useRollbackStore.getState().revertedFilesByTurnId['thread1:3'];
    expect(reverted).toEqual(['/test/a.ts']);
  });

  it('markFileRestored removes file from reverted list', () => {
    useRollbackStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    useRollbackStore.getState().markFileReverted('thread1', '3', '/test/b.ts');
    useRollbackStore.getState().markFileRestored('thread1', '3', '/test/a.ts');

    const reverted = useRollbackStore.getState().revertedFilesByTurnId['thread1:3'];
    expect(reverted).toEqual(['/test/b.ts']);
  });

  it('initRevertedFilesFromState populates from server state', () => {
    useRollbackStore.getState().setTurnCheckpointMapping('thread1', 5, 'ui-turn-5');
    const state = {
      context: { active: false, currentThroughTurnId: null },
      code: {
        canUndoLast: true,
        lastEntry: { throughTurnId: 5 } as any,
        revertedFiles: ['/a.ts', '/b.ts'],
        lastEntryId: 'e1',
      },
    };
    useRollbackStore.getState().setRollbackState('thread1', state as any);
    useRollbackStore.getState().initRevertedFilesFromState('thread1');

    const key = 'thread1:ui-turn-5';
    const reverted = useRollbackStore.getState().revertedFilesByTurnId[key];
    expect(reverted).toEqual(['/a.ts', '/b.ts']);
  });

  it('setTurnCheckpointMapping links checkpoint turnId to UI turnId', () => {
    useRollbackStore.getState().setTurnCheckpointMapping('thread1', 1, 'ui-turn-1');
    const mapping = useRollbackStore.getState().turnCheckpointMapping['thread1'];
    expect(mapping).toBeDefined();
    expect(mapping![1]).toBe('ui-turn-1');
  });

  it('checkpointDiffByTurnId key uses threadId:checkpointTurnId format', () => {
    const diff = {
      turnId: 1,
      files: [
        {
          path: '/a.ts',

          status: 'M',
          diff: '---\n+++\n',
          insertions: 1,
          deletions: 0,
        },
      ],
    };
    useRollbackStore.getState().setCheckpointDiff('thread1', '1', diff);

    const direct = useRollbackStore.getState().checkpointDiffByTurnId['thread1:1'];
    expect(direct).toBeDefined();
    expect(direct!.turnId).toBe(1);
  });

  it('turnCheckpointMapping resolves diff for UI turnId via mapping', () => {
    const diff = {
      turnId: 2,
      files: [
        {
          path: '/b.ts',

          status: 'M',
          diff: '---\n+++\n',
          insertions: 1,
          deletions: 0,
        },
      ],
    };
    useRollbackStore.getState().setCheckpointDiff('thread1', '2', diff);
    useRollbackStore.getState().setTurnCheckpointMapping('thread1', 2, 'ui-turn-2');

    const mapping = useRollbackStore.getState().turnCheckpointMapping['thread1'];
    expect(mapping![2]).toBe('ui-turn-2');

    // Simulating getCheckpointKey logic: when directKey misses, mapping resolves it
    const uiTurnId = 'ui-turn-2';
    const directKey = 'thread1:ui-turn-2';
    const cached = useRollbackStore.getState().checkpointDiffByTurnId[directKey];
    expect(cached).toBeUndefined();

    for (const [cpId, mappedUiId] of Object.entries(mapping!)) {
      if (mappedUiId === uiTurnId) {
        const resolvedKey = `thread1:${cpId}`;
        const resolvedDiff = useRollbackStore.getState().checkpointDiffByTurnId[resolvedKey];
        expect(resolvedDiff).toBeDefined();
        expect(resolvedDiff!.turnId).toBe(2);
        return;
      }
    }
    throw new Error('mapping lookup failed');
  });
});
