import { useState, useCallback } from 'react';
import type { UIMessage } from '../types.js';
import { generateId } from '../utils.js';

// 接收 AsyncGenerator<string>，不感知传输协议
export function useAgentRunner(runner: (input: string) => AsyncGenerator<string>) {
  const [staticMessages, setStaticMessages] = useState<UIMessage[]>([]);
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

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
        assistantContent += chunk;
        setActiveMessages([{
          id: assistantId,
          timestamp: Date.now(),
          role: 'assistant',
          content: assistantContent,
          isStreaming: true,
        }]);
      }

      setActiveMessages([]);
      setStaticMessages(prev => [...prev, {
        id: assistantId,
        timestamp: Date.now(),
        role: 'assistant',
        content: assistantContent,
        isStreaming: false,
      }]);
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

  return { staticMessages, activeMessages, setStaticMessages, setActiveMessages, run, isRunning, clearMessages };
}
