import { useState, useCallback } from 'react';
import type { Agent } from '../../../agent/agent';
import type { Result } from '../../../core/result';
import type { AgentError } from '../../../core/error';
import type { UIMessage } from '../types';
import { generateId } from '../utils';

export function useAgentRunner(agent: Agent) {
  const [staticMessages, setStaticMessages] = useState<UIMessage[]>([]);
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const run = useCallback(async (input: string) => {
    setIsRunning(true);

    // user 消息直接固化到 static
    const userMsg: UIMessage = {
      id: generateId(),
      timestamp: Date.now(),
      role: 'user',
      content: input,
    };
    setStaticMessages(prev => [...prev, userMsg]);

    // assistant 占位进入 active（流式中）
    const assistantId = generateId();
    let assistantContent = '';

    setActiveMessages([{
      id: assistantId,
      timestamp: Date.now(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    }]);

    try {
      const stream = agent.runStream(input);
      let iter = await stream.next();

      while (!iter.done) {
        const chunk: string = iter.value;
        assistantContent += chunk;
        setActiveMessages([{
          id: assistantId,
          timestamp: Date.now(),
          role: 'assistant',
          content: assistantContent,
          isStreaming: true,
        }]);
        iter = await stream.next();
      }

      const result = iter.value as Result<string, AgentError>;

      // 流式完成，assistant 从 active 移到 static
      setActiveMessages([]);
      setStaticMessages(prev => [...prev, {
        id: assistantId,
        timestamp: Date.now(),
        role: 'assistant',
        content: assistantContent,
        isStreaming: false,
      }]);

      if (!result.ok) {
        setStaticMessages(prev => [...prev, {
          id: generateId(),
          timestamp: Date.now(),
          role: 'system',
          content: `[Error] ${result.error.code}: ${result.error.message}`,
        }]);
      }
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
  }, [agent]);

  const clearMessages = useCallback(() => {
    setStaticMessages([]);
    setActiveMessages([]);
  }, []);

  return {
    staticMessages,
    activeMessages,
    setStaticMessages,
    setActiveMessages,
    run,
    isRunning,
    clearMessages,
  };
}
