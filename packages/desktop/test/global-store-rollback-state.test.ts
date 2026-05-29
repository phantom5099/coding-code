import { describe, it, expect, beforeEach } from 'vitest';
import { useGlobalStore } from '../src/stores/global.store';

describe('Rollback state in global store', () => {
  beforeEach(() => {
    // Reset the store state
    useGlobalStore.setState({
      rollback: {
        rollbackStateByThreadId: {},
        checkpointDiffByTurnId: {},
        rollbackPreviewByThreadId: {},
        revertedFilesByTurnId: {},
      },
    });
  });

  it('setRollbackState stores session rollback state', () => {
    const state = {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: true, lastEntry: null, revertedFiles: ['/test/file.ts'], lastEntryId: 'entry1' },
    };
    useGlobalStore.getState().setRollbackState('thread1', state as any);

    const stored = useGlobalStore.getState().rollback.rollbackStateByThreadId['thread1'];
    expect(stored).toBeDefined();
    expect(stored.code.revertedFiles).toEqual(['/test/file.ts']);
  });

  it('setCheckpointDiff stores diff by thread and turn', () => {
    const diff = { turnId: 3, files: [{ path: '/test/a.ts', source: 'agent' as const, status: 'M', diff: '---\n+++\n' }] };
    useGlobalStore.getState().setCheckpointDiff('thread1', '3', diff);

    const cached = useGlobalStore.getState().rollback.checkpointDiffByTurnId['thread1:3'];
    expect(cached).toBeDefined();
    expect(cached.turnId).toBe(3);
    expect(cached.files).toHaveLength(1);
  });

  it('setRollbackPreview stores preview', () => {
    const preview = { throughTurnId: 2, baseTurnId: 1, affectedTurns: [3, 4], diff: 'diff content' };
    useGlobalStore.getState().setRollbackPreview('thread1', preview);

    const cached = useGlobalStore.getState().rollback.rollbackPreviewByThreadId['thread1'];
    expect(cached).toBeDefined();
    expect(cached.diff).toBe('diff content');
  });

  it('clearRollbackPreview removes preview', () => {
    const preview = { throughTurnId: 2, baseTurnId: 1, affectedTurns: [3, 4], diff: 'diff content' };
    useGlobalStore.getState().setRollbackPreview('thread1', preview);
    expect(useGlobalStore.getState().rollback.rollbackPreviewByThreadId['thread1']).toBeDefined();

    useGlobalStore.getState().clearRollbackPreview('thread1');
    expect(useGlobalStore.getState().rollback.rollbackPreviewByThreadId['thread1']).toBeUndefined();
  });

  it('markFileReverted adds file to reverted list', () => {
    useGlobalStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    const reverted = useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1:3'];
    expect(reverted).toContain('/test/a.ts');
  });

  it('markFileReverted does not duplicate entries', () => {
    useGlobalStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    useGlobalStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    const reverted = useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1:3'];
    expect(reverted).toEqual(['/test/a.ts']);
  });

  it('markFileRestored removes file from reverted list', () => {
    useGlobalStore.getState().markFileReverted('thread1', '3', '/test/a.ts');
    useGlobalStore.getState().markFileReverted('thread1', '3', '/test/b.ts');
    useGlobalStore.getState().markFileRestored('thread1', '3', '/test/a.ts');

    const reverted = useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1:3'];
    expect(reverted).toEqual(['/test/b.ts']);
  });

  it('markScopeReverted sets sentinel', () => {
    useGlobalStore.getState().markScopeReverted('thread1', '3', 'agent');
    const reverted = useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1:3'];
    expect(reverted).toContain('__scope_reverted__');
  });

  it('markScopeRestored removes entry', () => {
    useGlobalStore.getState().markScopeReverted('thread1', '3', 'agent');
    useGlobalStore.getState().markScopeRestored('thread1', '3', 'agent');
    expect(useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1:3']).toBeUndefined();
  });

  it('initRevertedFilesFromState populates from server state', () => {
    const state = {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: true, lastEntry: null, revertedFiles: ['/a.ts', '/b.ts'], lastEntryId: 'e1' },
    };
    useGlobalStore.getState().setRollbackState('thread1', state as any);
    useGlobalStore.getState().initRevertedFilesFromState('thread1');

    const reverted = useGlobalStore.getState().rollback.revertedFilesByTurnId['thread1'];
    expect(reverted).toEqual(['/a.ts', '/b.ts']);
  });
});
