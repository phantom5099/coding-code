import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Item } from '@shared/types';
import { useAgentStore } from '../stores/agent.store';
import { sendAskUserAnswer } from '../lib/core-api';

interface AskUserPanelProps {
  threadId: string;
}

const letterOf = (index: number): string => String.fromCharCode(65 + index);

export default function AskUserPanel({ threadId }: AskUserPanelProps) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const waitingKey = useAgentStore((s) => {
    const thread = s.threads[threadId];
    if (!thread) return '';
    return thread.turns
      .flatMap((t) => t.items)
      .filter((i) => i.type === 'ask_user' && i.status === 'waiting')
      .map((i) => i.id)
      .join(',');
  });

  const waitingItems = useMemo(() => {
    if (!waitingKey) return [];
    const thread = useAgentStore.getState().threads[threadId];
    if (!thread) return [];
    return thread.turns.flatMap((turn) =>
      turn.items.filter(
        (i): i is Item & { type: 'ask_user' } => i.type === 'ask_user' && i.status === 'waiting'
      )
    );
  }, [waitingKey, threadId]);

  // 切题或题目集合变化时重置表单
  useEffect(() => {
    setChoice(null);
    setChoices([]);
    setCustom('');
  }, [waitingKey, index]);

  const clampedIndex = Math.min(index, Math.max(waitingItems.length - 1, 0));
  const current = waitingItems[clampedIndex] ?? null;

  const customText = custom.trim();
  const selectedCount =
    current?.questiontype === 'single'
      ? choice
        ? 1
        : 0
      : current?.questiontype === 'multiple'
        ? choices.length
        : 0;
  const canSubmit =
    !!current &&
    !submitting &&
    (current.questiontype === 'text'
      ? customText !== ''
      : selectedCount > 0 || customText !== '');

  const handleSubmit = useCallback(async () => {
    if (!current || !canSubmit) return;
    const options =
      current.questiontype === 'single'
        ? choice
          ? [choice]
          : []
        : current.questiontype === 'multiple'
          ? choices
          : [];
    setSubmitting(true);
    try {
      await sendAskUserAnswer(threadId, current.callId, {
        options,
        custom: customText || undefined,
      });
      useAgentStore.getState().markAskAnswered(threadId, current.callId);
    } catch (e) {
      console.error('Failed to submit ask_user answer:', e);
    } finally {
      setSubmitting(false);
    }
  }, [current, canSubmit, choice, choices, customText, threadId]);

  if (!current) return null;

  return (
    <div className="fixed bottom-24 right-5 w-[360px] max-h-[70vh] z-40 flex flex-col">
      <div className="rounded-lg bg-[var(--bg-panel)] border border-[var(--border-card)] shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-code-header)] border-b border-[var(--border-card)]">
          <div className="flex items-center gap-2">
            <span>❓</span>
            <span className="text-[13px] text-[var(--text-primary)] font-medium">
              模型提问{waitingItems.length > 1 ? `（${clampedIndex + 1}/${waitingItems.length}）` : ''}
            </span>
          </div>
          {waitingItems.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIndex((v) => Math.max(v - 1, 0))}
                disabled={clampedIndex === 0}
                className="px-2 py-0.5 text-[13px] rounded bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 hover:bg-[var(--bg-active)] transition-colors"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setIndex((v) => Math.min(v + 1, waitingItems.length - 1))}
                disabled={clampedIndex >= waitingItems.length - 1}
                className="px-2 py-0.5 text-[13px] rounded bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 hover:bg-[var(--bg-active)] transition-colors"
              >
                →
              </button>
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="text-[13px] text-[var(--text-primary)] leading-relaxed">{current.question}</div>

          {current.questiontype === 'single' && (
            <div className="flex flex-col gap-1.5">
              {current.options.slice(0, 4).map((text, i) => (
                <label
                  key={i}
                  className="flex items-center gap-2 text-[13px] text-[var(--text-primary)] cursor-pointer"
                >
                  <input
                    type="radio"
                    name={`ask-${current.callId}`}
                    checked={choice === letterOf(i)}
                    onChange={() => {
                      setChoice(letterOf(i));
                      // 单选中选项与自定义输入互斥：改选选项即清空自定义输入
                      setCustom('');
                    }}
                  />
                  <span>
                    {letterOf(i)}. {text}
                  </span>
                </label>
              ))}
            </div>
          )}

          {current.questiontype === 'multiple' && (
            <div className="flex flex-col gap-1.5">
              {current.options.slice(0, 4).map((text, i) => (
                <label
                  key={i}
                  className="flex items-center gap-2 text-[13px] text-[var(--text-primary)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={choices.includes(letterOf(i))}
                    onChange={() =>
                      setChoices((prev) =>
                        prev.includes(letterOf(i))
                          ? prev.filter((l) => l !== letterOf(i))
                          : [...prev, letterOf(i)]
                      )
                    }
                  />
                  <span>
                    {letterOf(i)}. {text}
                  </span>
                </label>
              ))}
            </div>
          )}

          {current.questiontype === 'text' ? (
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="输入你的回答…"
              rows={3}
              className="w-full rounded border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] resize-y"
            />
          ) : (
            <input
              type="text"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                // 单选中选项与自定义输入互斥：一旦输入自定义即取消已勾选的选项
                if (current.questiontype === 'single') setChoice(null);
              }}
              placeholder="其他：输入选项以外的答案…"
              className="w-full rounded border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
            />
          )}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="self-end px-3 py-1.5 text-[13px] bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/80 text-[var(--text-inverse)] rounded transition-colors disabled:opacity-40"
          >
            {submitting ? '提交中…' : '提交回答'}
          </button>
        </div>
      </div>
    </div>
  );
}
