import { useState, useCallback, useRef } from 'react';
import type { UIMessage } from '../types.js';
import type { StreamChunk } from '../index.js';
import { generateId } from '../utils.js';

export interface ApprovalPanel {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  resolve: (response: string) => void;
}

export function useAgentRunner(runner: (input: string) => AsyncGenerator<StreamChunk>) {
  const [staticMessages, setStaticMessages] = useState<UIMessage[]>([]);
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [approval, setApproval] = useState<ApprovalPanel | null>(null);

  const run = useCallback(async (input: string) => {
    setIsRunning(true);

    const userMsg: UIMessage = {
      id: generateId(),
      timestamp: Date.now(),
      role: 'user',
      content: input,
    };
    setStaticMessages(prev => [...prev, userMsg]);

    const assistantId = generateId();
    let assistantContent = '';
    const pendingTodods: UIMessage[] = [];

    setActiveMessages([{
      id: assistantId,
      timestamp: Date.now(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    }]);

    try {
      const stream = runner(input);

      for await (const chunk of stream) {
        if (typeof chunk === 'string') {
          if (chunk.startsWith('[Using:')) {
            const toolName = chunk.replace('[Using:', '').replace(']', '').trim();
            setStaticMessages(prev => [...prev, {
              id: generateId(),
              timestamp: Date.now(),
              role: 'tool',
              content: '',
              toolName,
            }]);
            continue;
          }
          if (chunk.startsWith('[Denied:')) {
            const rest = chunk.replace('[Denied:', '').trim();
            const [toolName, ...reasonParts] = rest.split(']');
            setStaticMessages(prev => [...prev, {
              id: generateId(),
              timestamp: Date.now(),
              role: 'system',
              content: `⛔ Tool "${toolName}" was denied: ${reasonParts.join(']').trim() || 'not allowed'}`,
              toolName: toolName,
            }]);
            continue;
          }
          assistantContent += chunk;
          setActiveMessages([{
            id: assistantId,
            timestamp: Date.now(),
            role: 'assistant',
            content: assistantContent,
            isStreaming: true,
          }]);
        } else if (chunk.type === 'approval_request') {
          // 收到审批请求 → 显示 InlinePanel，暂停流读取
          const response = await new Promise<string>((resolve) => {
            setApproval({
              id: chunk.id,
              tool: chunk.tool,
              args: chunk.args,
              resolve,
            });
          });
          // 用户已选择 → 关闭面板，继续流
          setApproval(null);
        } else if ((chunk as any).type === 'todo_update') {
          const items = (chunk as any).items as Array<{ step: string; status: string }>;
          const pending = items.filter(t => t.status === 'pending');
          const completed = items.filter(t => t.status === 'completed');
          const cancelled = items.filter(t => t.status === 'cancelled');
          const summary = `${pending.length} 进行中, ${completed.length} 已完成` +
            (cancelled.length > 0 ? `, ${cancelled.length} 已取消` : '');
          pendingTodods.push({
            id: generateId(),
            timestamp: Date.now(),
            role: 'tool',
            content: items.map(t => {
              const icon = t.status === 'completed' ? '✓' : t.status === 'cancelled' ? '✗' : '○';
              return `${icon} ${t.step}`;
            }).join('\n'),
            toolName: `Todo (${summary})`,
          });
          continue;
        }
      }

      setActiveMessages([]);
      setStaticMessages(prev => [
        ...prev,
        {
          id: assistantId,
          timestamp: Date.now(),
          role: 'assistant',
          content: assistantContent,
          isStreaming: false,
        },
        ...pendingTodods,
      ]);
    } catch (err: any) {
      setActiveMessages([]);
      setStaticMessages(prev => [...prev, {
        id: generateId(),
        timestamp: Date.now(),
        role: 'system',
        content: `[Error] ${err.message || err}`,
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [runner]);

  const clearMessages = useCallback(() => {
    setStaticMessages([]);
    setActiveMessages([]);
  }, []);

  return { staticMessages, activeMessages, setStaticMessages, setActiveMessages, run, isRunning, clearMessages, approval, setApproval };
}
