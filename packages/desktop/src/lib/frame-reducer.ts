import type { Frame, ToolOutcome } from '@codingcode/core/core/frame';
import type { Item, TodoItem } from '@shared/types';

export interface StreamState {
  assistantMessageId: string;
  roundHasText: boolean;
  hasError: boolean;
  planTitle: string | null;
  turnIdSynced: boolean;
}

export function createStreamState(assistantMessageId: string): StreamState {
  return {
    assistantMessageId,
    roundHasText: false,
    hasError: false,
    planTitle: null,
    turnIdSynced: false,
  };
}

/** reducer 的外部副作用出口 */
export interface StreamEffects {
  applyItem(item: Item): void;
  applyTodo(items: TodoItem[]): void;
  setUsage(usage: { prompt: number; completion: number; total: number }): void;
  /** 进入压缩：重置该线程的累计用量（下一次 responded.usage 会带来真实值） */
  setCompacted(): void;
  syncTurnId(turnId: number): void;
  newId(): string;
}

function toResultItem(outcome: ToolOutcome): { output: string; exitCode: number } {
  if (outcome.status === 'denied') return { output: outcome.reason, exitCode: 1 };
  return { output: outcome.output, exitCode: outcome.status === 'ok' ? 0 : 1 };
}

/**
 * transition 只改 phase 与消息边界；event 只累积内容。
 * 文本段以 responded 收尾——这是服务端给出的消息边界，不再由客户端伪造。
 */
export function reduceFrame(frame: Frame, state: StreamState, fx: StreamEffects): void {
  if (!state.turnIdSynced && frame.turnId !== null) {
    state.turnIdSynced = true;
    fx.syncTurnId(frame.turnId);
  }

  if (frame.family === 'fatal') {
    state.hasError = true;
    fx.applyItem({ id: fx.newId(), type: 'error', message: frame.fatal.message, code: frame.fatal.code });
    return;
  }

  if (frame.family === 'transition') {
    const t = frame.transition;
    if (t.to === 'end') {
      if (t.reason === 'error') {
        state.hasError = true;
        fx.applyItem({ id: fx.newId(), type: 'error', message: t.error.message, code: t.error.code });
      }
      return;
    }
    if (t.to === 'compress') {
      fx.setCompacted();
      return;
    }
    if (t.to === 'executing') {
      if (t.responded) {
        if (state.roundHasText) {
          fx.applyItem({
            id: state.assistantMessageId,
            type: 'message',
            role: 'assistant',
            content: '',
            partial: false,
          });
        }
        state.roundHasText = false;
        state.assistantMessageId = fx.newId();
        if (t.responded.usage) fx.setUsage(t.responded.usage);
      }
    }
    return;
  }

  const e = frame.event;
  switch (e.type) {
    case 'text_delta':
      state.roundHasText = true;
      fx.applyItem({
        id: state.assistantMessageId,
        type: 'message',
        role: 'assistant',
        content: e.text,
        partial: true,
      });
      return;
    case 'tool_call':
      if (e.name === 'submit_plan') {
        state.planTitle = String((e.args as Record<string, unknown>).title ?? '');
      }
      fx.applyItem({
        id: e.id,
        type: 'tool_call',
        name: e.name,
        args: e.args as object,
        status: 'running',
      });
      return;
    case 'approval_request':
      fx.applyItem({
        id: e.id,
        type: 'tool_call',
        name: e.tool,
        args: e.args as object,
        status: 'pending',
      });
      return;
    case 'tool_result': {
      if (e.name === 'submit_plan' && e.outcome.status !== 'ok') state.planTitle = null;
      if (e.outcome.status === 'denied') {
        fx.applyItem({ id: e.id, type: 'tool_call', name: e.name, args: {}, status: 'rejected' });
      }
      const { output, exitCode } = toResultItem(e.outcome);
      fx.applyItem({ id: fx.newId(), type: 'tool_result', callId: e.id, name: e.name, output, exitCode });
      if (e.todos) fx.applyTodo(e.todos as TodoItem[]);
      return;
    }
  }
}
