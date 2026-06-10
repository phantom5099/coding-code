import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGlobalStore } from '../stores/global.store';
import MessageItem from '../shared/MessageItem';
import UnifiedDiffView from '../shared/UnifiedDiffView';
import type { Item } from '@shared/types';
import type { CheckpointDiff } from '../lib/core-api';
import { useAgentApproval, useAgentRollback } from '../hooks/useAgent';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

interface MessageStreamProps {
  threadId: string;
}

const EMPTY_MAPPING: Record<number, string> = {};

interface TurnDiffPanelProps {
  uiTurnId: string;
  isInterrupted?: boolean;
  threadId: string;
  onRevertFile: (uiTurnId: string, file: string, isReverted: boolean) => void;
  onRevertScope: (uiTurnId: string, scope: 'agent' | 'all', isReverted: boolean) => void;
}

function getCheckpointKey(
  threadId: string,
  uiTurnId: string,
  checkpointDiffs: Record<string, CheckpointDiff>,
  turnCheckpointMapping: Record<number, string>
): string | null {
  const directKey = `${threadId}:${uiTurnId}`;
  if (checkpointDiffs[directKey]) {
    return directKey;
  }
  for (const [cpId, mappedUiId] of Object.entries(turnCheckpointMapping)) {
    if (mappedUiId === uiTurnId) {
      return `${threadId}:${cpId}`;
    }
  }
  for (const key of Object.keys(checkpointDiffs)) {
    if (!key.startsWith(`${threadId}:`)) continue;
    const cpIntStr = key.slice(threadId.length + 1);
    if (turnCheckpointMapping[Number(cpIntStr)] === uiTurnId) {
      return key;
    }
  }
  return null;
}

function TurnDiffPanel({
  uiTurnId,
  isInterrupted,
  threadId,
  onRevertFile,
  onRevertScope,
}: TurnDiffPanelProps) {
  const rawCheckpointDiffByTurnId = useGlobalStore((s) => s.rollback.checkpointDiffByTurnId);
  const rawTurnCheckpointMapping = useGlobalStore((s) => s.rollback.turnCheckpointMapping);
  const revertedFilesByTurnId = useGlobalStore((s) => s.rollback.revertedFilesByTurnId);

  const checkpointDiffs = useMemo(() => {
    const prefix = `${threadId}:`;
    const result: Record<string, CheckpointDiff> = {};
    for (const [k, v] of Object.entries(rawCheckpointDiffByTurnId)) {
      if (k.startsWith(prefix)) result[k] = v;
    }
    return result;
  }, [threadId, rawCheckpointDiffByTurnId]);

  const turnCheckpointMapping = rawTurnCheckpointMapping[threadId] ?? EMPTY_MAPPING;
  const ckKey = getCheckpointKey(threadId, uiTurnId, checkpointDiffs, turnCheckpointMapping);
  const diff = ckKey ? checkpointDiffs[ckKey] : null;
  const revertedFiles = revertedFilesByTurnId[`${threadId}:${uiTurnId}`] ?? [];
  const isAgentReverted = revertedFiles.includes('__scope_agent_reverted__');
  const isAllReverted = revertedFiles.includes('__scope_all_reverted__');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  if (!diff || !diff.files || diff.files.length === 0) {
    return null;
  }

  const totalInsertions = diff.files.reduce((sum: number, f: any) => sum + (f.insertions ?? 0), 0);
  const totalDeletions = diff.files.reduce((sum: number, f: any) => sum + (f.deletions ?? 0), 0);

  return (
    <div className="mt-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-card)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[var(--bg-hover)] flex items-center justify-center">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 1v14M1 8h14"
                stroke="var(--text-muted)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <span className="text-[13px] text-[var(--text-primary)]">
              已编辑 {diff.files.length} 个文件
            </span>
            {isInterrupted && (
              <span className="ml-2 text-[11px] text-[var(--accent-danger)]">（对话中断）</span>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              {totalInsertions > 0 && (
                <span className="text-[12px] text-[var(--accent-success)]">+{totalInsertions}</span>
              )}
              {totalDeletions > 0 && (
                <span className="text-[12px] text-[var(--accent-danger)]">-{totalDeletions}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRevertScope(uiTurnId, 'all', isAllReverted)}
            className={`text-[12px] px-3 py-1 rounded ${
              isAllReverted
                ? 'bg-[var(--accent-success)] text-[var(--text-inverse)] hover:bg-[var(--accent-success)]/80'
                : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-active)] border border-[var(--border-strong)]'
            }`}
          >
            {isAllReverted ? '撤销回退本轮全部修改' : '回退本轮全部修改'}
          </button>
          <button
            onClick={() => onRevertScope(uiTurnId, 'agent', isAgentReverted)}
            className={`text-[12px] px-3 py-1 rounded ${
              isAgentReverted
                ? 'bg-[var(--accent-success)] text-[var(--text-inverse)] hover:bg-[var(--accent-success)]/80'
                : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-active)] border border-[var(--border-strong)]'
            }`}
          >
            {isAgentReverted ? '撤销回退 Agent 修改' : '只回退 Agent 修改'}
          </button>
        </div>
      </div>
      <div className="border-t border-[var(--border-card)]">
        {diff.files.map((f: any) => {
          const isExpanded = expandedFile === f.path;
          const isFileIndividuallyReverted = revertedFiles.includes(f.path);
          const isFileScopeReverted = isAllReverted || (isAgentReverted && f.source === 'agent');
          const isReverted = isFileIndividuallyReverted || isFileScopeReverted;
          return (
            <div key={f.path}>
              <div
                className="flex items-center justify-between px-4 py-2 hover:bg-[var(--bg-hover)] cursor-pointer"
                onClick={() => setExpandedFile(isExpanded ? null : f.path)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-[12px] text-[var(--text-primary)] truncate">
                    {f.path.replace(/\\/g, '/')}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {f.source === 'agent' ? 'Agent' : '未知'}
                  </span>
                  {isReverted && (
                    <span className="text-[10px] text-[var(--accent-danger)] shrink-0">已回退</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    {f.insertions > 0 && (
                      <span className="text-[var(--accent-success)]">+{f.insertions}</span>
                    )}
                    {f.deletions > 0 && (
                      <span className="text-[var(--accent-danger)]">-{f.deletions}</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRevertFile(uiTurnId, f.path, isReverted);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      isReverted
                        ? 'bg-[var(--accent-success)] text-[var(--text-inverse)] hover:bg-[var(--accent-success)]/80'
                        : 'bg-[var(--bg-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-active)]'
                    }`}
                  >
                    {isReverted ? '撤销' : '回退'}
                  </button>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  >
                    <path
                      d="M3 4.5L6 7.5L9 4.5"
                      stroke="var(--text-muted)"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              {isExpanded && (
                <div className="px-4 pb-2">
                  <UnifiedDiffView diff={f.diff} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MessageStream({ threadId }: MessageStreamProps) {
  const turns = useGlobalStore((s) => s.agent.threads[threadId]?.turns ?? []);
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread);
  const { approveTool, rejectTool } = useAgentApproval();
  const {
    loadCheckpointDiff,
    revertFile,
    revertAgentFiles,
    revertAllFiles,
    previewRollback,
    rollbackCtx,
    rollbackBoth,
    undoCodeRollback,
    forkThread,
    revertedFilesByTurnId,
  } = useAgentRollback();
  const { copiedId, copy } = useCopyToClipboard();
  const parentRef = useRef<HTMLDivElement>(null);
  const markScopeRestored = useGlobalStore((s) => s.markScopeRestored);
  const markFileRestored = useGlobalStore((s) => s.markFileRestored);
  const setPendingInput = useGlobalStore((s) => s.setPendingInput);

  const [showRollbackPanel, setShowRollbackPanel] = useState<{
    turnId: string;
    preview: any;
  } | null>(null);

  const turnsStructureKey = useMemo(
    () =>
      turns
        .map(
          (t) =>
            `${t.id}:${t.status}:${t.items.length}:${t.items.map((i) => `${i.type}:${i.id}`).join(',')}`
        )
        .join('|'),
    [turns]
  );

  const { renderEntries, callIdToToolName, entryCountByTurnId, turnById, assistantContentByTurnId } = useMemo(() => {
    const entries: Array<{
      item: Item;
      turnId: string;
      toolResult?: Item & { type: 'tool_result' };
      key: string;
    }> = [];
    const toolResultByCallId: Record<string, Item & { type: 'tool_result' }> = {};
    const nameMap: Record<string, string> = {};
    const countMap = new Map<string, number>();
    const turnMap = new Map<string, (typeof turns)[number]>();
    const contentMap = new Map<string, string>();

    for (const turn of turns) {
      turnMap.set(turn.id, turn);
      const assistantParts: string[] = [];
      for (const item of turn.items) {
        if (item.type === 'tool_result') {
          toolResultByCallId[item.callId] = item as any;
        } else if (item.type === 'tool_call') {
          nameMap[item.id] = item.name;
        } else if (item.type === 'message' && item.role === 'assistant' && item.content) {
          assistantParts.push(item.content);
        }
      }
      if (assistantParts.length > 0) {
        contentMap.set(turn.id, assistantParts.join('\n\n'));
      }
    }
    for (const turn of turns) {
      for (const item of turn.items) {
        if (item.type === 'tool_result') continue;
        if (item.type === 'tool_call') {
          entries.push({
            item,
            turnId: turn.id,
            toolResult: toolResultByCallId[item.id],
            key: item.id,
          });
        } else {
          entries.push({ item, turnId: turn.id, key: item.id });
        }
        countMap.set(turn.id, (countMap.get(turn.id) ?? 0) + 1);
      }
    }

    return {
      renderEntries: entries,
      callIdToToolName: nameMap,
      entryCountByTurnId: countMap,
      turnById: turnMap,
      assistantContentByTurnId: contentMap,
    };
  }, [turnsStructureKey]);

  const { turnEndIndices, turnRollbackCallbacks } = useMemo(() => {
    const endIndices = new Set<number>();
    const rollbackCbs = new Map<
      string,
      {
        onRollbackHere?: () => void;
        onForkFromHere?: () => void;
      }
    >();
    let idx = 0;
    for (const turn of turns) {
      const turnEntryCount = entryCountByTurnId.get(turn.id) ?? 0;
      idx += turnEntryCount - 1;
      if (turn.status === 'completed' || turn.status === 'error') {
        endIndices.add(idx);
        const turnNum = parseInt(turn.id, 10);
        rollbackCbs.set(turn.id, {
          onRollbackHere: !isNaN(turnNum)
            ? () => {
                previewRollback(threadId, turnNum).then((preview: any) => {
                  setShowRollbackPanel({ turnId: String(turnNum), preview });
                });
              }
            : undefined,
          onForkFromHere: async () => {
            const lastItem = turn.items[turn.items.length - 1];
            if (lastItem) {
              const userMsg = turn.items.find(
                (i) => i.type === 'message' && (i as any).role === 'user'
              );
              const userContent = userMsg && 'content' in userMsg ? (userMsg as any).content : '';
              const newSessionId = await forkThread(threadId, lastItem.id);
              if (newSessionId) {
                setCurrentThread(newSessionId);
                if (userContent) setPendingInput(userContent);
              }
            }
          },
        });
      }
      idx++;
    }
    return { turnEndIndices: endIndices, turnRollbackCallbacks: rollbackCbs };
  }, [
    turnsStructureKey,
    entryCountByTurnId,
    threadId,
    previewRollback,
    forkThread,
    setCurrentThread,
    setPendingInput,
  ]);

  const virtualizer = useVirtualizer({
    count: renderEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    getItemKey: (index: number) => renderEntries[index]?.key ?? `empty-${index}`,
    overscan: 5,
    anchorTo: 'end',
    followOnAppend: 'smooth',
    scrollEndThreshold: 80,
  });

  const turnStatusKey = useMemo(() => turns.map((t) => `${t.id}:${t.status}`).join(','), [turns]);

  const handleLoadDiff = useCallback(
    async (uiTurnId: string) => {
      const diff = await loadCheckpointDiff(threadId);
      if (diff.turnId > 0) {
        const state = useGlobalStore.getState();
        const mapping = state.rollback.turnCheckpointMapping[threadId];
        if (mapping?.[diff.turnId] !== uiTurnId) {
          state.setTurnCheckpointMapping(threadId, diff.turnId, uiTurnId);
        }
      }
    },
    [threadId, loadCheckpointDiff]
  );

  useEffect(() => {
    for (const turn of turns) {
      if (turn.status !== 'completed' && turn.status !== 'error') continue;
      const ckKey = getCheckpointKey(
        threadId,
        turn.id,
        useGlobalStore.getState().rollback.checkpointDiffByTurnId,
        useGlobalStore.getState().rollback.turnCheckpointMapping[threadId] ?? EMPTY_MAPPING
      );
      if (!ckKey) {
        handleLoadDiff(turn.id);
      }
    }
  }, [turnStatusKey, threadId, handleLoadDiff]);

  const handleRevertFile = useCallback(
    async (uiTurnId: string, file: string, isReverted: boolean) => {
      if (isReverted) {
        const result = await undoCodeRollback(threadId, uiTurnId, false, [file]);
        if (result.restored) {
          markFileRestored(threadId, uiTurnId, file);
        }
      } else {
        await revertFile(threadId, file);
      }
    },
    [threadId, revertFile, undoCodeRollback, markFileRestored]
  );

  const handleRevertScope = useCallback(
    async (uiTurnId: string, scope: 'agent' | 'all', isReverted: boolean) => {
      if (isReverted) {
        const result = await undoCodeRollback(threadId, uiTurnId, false);
        if (result.restored) {
          markScopeRestored(threadId, uiTurnId, scope);
        }
      } else if (scope === 'agent') {
        await revertAgentFiles(threadId);
      } else {
        await revertAllFiles(threadId);
      }
    },
    [threadId, revertAgentFiles, revertAllFiles, undoCodeRollback, markScopeRestored]
  );

  const rollbackModal = showRollbackPanel && (
    <div className="fixed inset-0 bg-[var(--overlay-bg)] flex items-center justify-center z-50">
      <div className="bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-[15px] text-[var(--text-primary)] mb-4">
          将回退到 Turn {showRollbackPanel.turnId}
        </h3>
        {showRollbackPanel.preview && (
          <div className="mb-4">
            <div className="text-[12px] text-[var(--text-secondary)] mb-2">
              回退前 / 回退后差异：
            </div>
            <pre className="text-[11px] bg-[var(--bg-code)] p-3 rounded text-[var(--text-secondary)] max-h-[300px] overflow-auto whitespace-pre-wrap">
              {showRollbackPanel.preview.diff || '无差异'}
            </pre>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!showRollbackPanel) return;
              await rollbackCtx(threadId, parseInt(showRollbackPanel.turnId, 10));
              setShowRollbackPanel(null);
            }}
            className="text-[12px] px-3 py-1.5 rounded bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
          >
            只回退上下文
          </button>
          <button
            onClick={async () => {
              if (!showRollbackPanel) return;
              await rollbackBoth(threadId, parseInt(showRollbackPanel.turnId, 10));
              setShowRollbackPanel(null);
            }}
            className="text-[12px] px-3 py-1.5 rounded bg-[var(--accent-danger)] text-[var(--text-inverse)] hover:bg-[var(--accent-danger)]/80"
          >
            上下文和代码都回退
          </button>
          <button
            onClick={() => setShowRollbackPanel(null)}
            className="text-[12px] px-3 py-1.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-active)]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={parentRef}
        className="flex-1 select-text"
        style={{ overflowY: 'auto', contain: 'strict', overflowAnchor: 'none' }}
      >
        {renderEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-placeholder)] text-[15px]">
            发送消息开始对话
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = renderEntries[virtualRow.index];
              if (!entry) return null;
              const isLastInTurn = turnEndIndices.has(virtualRow.index);
              const cbs = turnRollbackCallbacks.get(entry.turnId);
              const isUserMsg = entry.item.type === 'message' && entry.item.role === 'user';
              const turn = turnById.get(entry.turnId);
              const isInterrupted = turn?.status === 'error';

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="px-10 py-1">
                    <MessageItem
                      item={entry.item}
                      threadId={threadId}
                      onApprove={approveTool}
                      onReject={rejectTool}
                      callIdToToolName={callIdToToolName}
                      onRollbackHere={isUserMsg && cbs ? cbs.onRollbackHere : undefined}
                      onForkFromHere={isUserMsg && cbs ? cbs.onForkFromHere : undefined}
                      toolResult={entry.toolResult}
                    />
                  </div>
                  {isLastInTurn && (() => {
                    const assistantContent = assistantContentByTurnId.get(entry.turnId);
                    const isTurnDone = turn?.status === 'completed' || turn?.status === 'error';
                    if (!assistantContent || !isTurnDone) return null;
                    const isCopied = copiedId === `turn-${entry.turnId}`;
                    return (
                      <div className="px-10 pb-1 group/turnCopy">
                        <div className="pl-8 flex items-center gap-1.5 opacity-0 group-hover/turnCopy:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(assistantContent, `turn-${entry.turnId}`);
                            }}
                            aria-label="复制助手消息"
                            title="复制"
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                              isCopied
                                ? 'bg-[var(--accent-success)] text-[var(--text-inverse)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                            }`}
                          >
                            {isCopied ? <Check size={12} /> : <Copy size={12} />}
                            {isCopied ? '已复制' : '复制'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                  {isLastInTurn && (
                    <div className="px-6 pb-2">
                      <TurnDiffPanel
                        uiTurnId={entry.turnId}
                        isInterrupted={isInterrupted}
                        threadId={threadId}
                        onRevertFile={handleRevertFile}
                        onRevertScope={handleRevertScope}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {rollbackModal}
    </div>
  );
}
