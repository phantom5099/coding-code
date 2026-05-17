import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import { useAgentRunner } from '../hooks/useAgentRunner.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { historyToUIMessages, generateId } from '../utils.js';
import type { OverlayState } from '../types.js';
import { MessageItem } from './MessageItem.js';
import { InputBox } from './InputBox.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { CommandOverlay } from './CommandOverlay.js';
import { ModelPicker } from './ModelPicker.js';
import { RolePicker } from './RolePicker.js';
import { SessionPicker } from './SessionPicker.js';
import { HelpOverlay } from './HelpOverlay.js';
import { buildWelcomeContent } from './WelcomePanel.js';

interface AppProps {
  client: Record<string, any>;
  sessionId: string;
}

export function App({ client, sessionId }: AppProps) {
  const { exit } = useApp();
  const { width } = useTerminalSize();
  const runner = useCallback(
    (input: string) => client.sendMessage(sessionId, input),
    [client, sessionId],
  );
  const {
    staticMessages,
    activeMessages,
    setStaticMessages,
    setActiveMessages,
    run,
    isRunning,
    clearMessages,
  } = useAgentRunner(runner);
  const [overlay, setOverlay] = useState<OverlayState>({ type: 'none' });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [pickerIndex, setPickerIndex] = useState(0);
  const [staticKey, setStaticKey] = useState(0);
  const [modelName, setModelName] = useState('unknown');

  useEffect(() => {
    if (overlay.type !== 'none') setPickerIndex(0);
  }, [overlay.type]);

  useEffect(() => {
    (async () => {
      try {
        const info = await client.getSessionInfo();
        setModelName(info.model);
        const sessions = await client.listSessions();
        const current = sessions.find((s: any) => s.sessionId === sessionId);
        if (current) {
          const history = await client.resumeSession(current.sessionId);
          const uiMessages = historyToUIMessages(history.events || []);
          setStaticMessages(uiMessages);
        } else {
          const uiMsgs = [{
            id: generateId(), timestamp: Date.now(), role: 'welcome' as const,
            content: buildWelcomeContent({ model: modelName, role: 'coder', sessionId }),
          }];
          setStaticMessages(uiMsgs);
        }
      } catch {
        const uiMsgs = [{
          id: generateId(), timestamp: Date.now(), role: 'welcome' as const,
          content: buildWelcomeContent({ model: modelName, role: 'coder', sessionId }),
        }];
        setStaticMessages(uiMsgs);
      }
      setActiveMessages([]);
    })();
  }, [client, sessionId, setStaticMessages, setActiveMessages, modelName]);

  useEffect(() => {
    if (activeMessages.length > 0) setFocusedIndex(activeMessages.length - 1);
    else setFocusedIndex(null);
  }, [activeMessages.length]);

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === '/exit') { exit(); return; }
    if (trimmed === '/help') { setOverlay({ type: 'help' }); return; }
    if (trimmed === '/clear') {
      await client.clearSession();
      clearMessages();
      setStaticKey(k => k + 1);
      return;
    }
    if (trimmed === '/model') {
      const { models, activeId } = await client.listModels();
      setOverlay({ type: 'model', models: models.map((m: any) => ({ ...m, id: m.id || m.name, name: m.name || m.id, provider: m.provider || '', model: m.model || m.name })), activeId });
      return;
    }
    if (trimmed === '/role') {
      const { roles, currentRole } = await client.listRoles();
      setOverlay({ type: 'role', roles: roles.map((r: any) => ({ id: r.id || r, label: r.label || r, description: r.description || '' })), currentRole });
      return;
    }
    if (trimmed === '/sessions') {
      const sessions = await client.listSessions();
      setOverlay({ type: 'sessions', sessions });
      return;
    }

    await run(trimmed);
  }, [client, run, exit, clearMessages]);

  useInput((input, key) => {
    const overlayType = overlay.type;
    if (overlayType !== 'none') {
      if (key.escape) { setOverlay({ type: 'none' }); return; }
      const itemCount = overlayType === 'model' ? overlay.models.length : overlayType === 'role' ? overlay.roles.length : overlayType === 'sessions' ? overlay.sessions.length : 0;
      if (overlayType === 'help') return;
      if (key.upArrow) { setPickerIndex(prev => prev <= 0 ? itemCount - 1 : prev - 1); return; }
      if (key.downArrow) { setPickerIndex(prev => prev >= itemCount - 1 ? 0 : prev + 1); return; }
      if (key.return && itemCount > 0) {
        (async () => {
          if (overlayType === 'model') {
            await client.switchModel((overlay as any).models[pickerIndex]?.id);
            setOverlay({ type: 'none' });
          } else if (overlayType === 'role') {
            await client.switchRole((overlay as any).roles[pickerIndex]?.id);
            setOverlay({ type: 'none' });
          } else if (overlayType === 'sessions') {
            const s = (overlay as any).sessions[pickerIndex];
            await client.resumeSession(s.sessionId);
            setOverlay({ type: 'none' });
            setStaticKey(k => k + 1);
          }
        })();
        return;
      }
      return;
    }

    if (key.upArrow) { if (activeMessages.length === 0) return; setFocusedIndex(prev => (prev === null || prev <= 0) ? activeMessages.length - 1 : prev - 1); return; }
    if (key.downArrow) { if (activeMessages.length === 0) return; setFocusedIndex(prev => (prev === null || prev >= activeMessages.length - 1) ? 0 : prev + 1); return; }
    if (key.ctrl && input === 'o' && focusedIndex !== null) {
      const msg = activeMessages[focusedIndex];
      if (msg) setExpandedMap(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
    }
  });

  const modelW = Math.min(60, width - 4);
  const roleW = Math.min(60, width - 4);
  const sessionW = Math.min(70, width - 4);
  const helpW = Math.min(50, width - 4);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">coding-agent</Text>
        <Text color="gray" dimColor>  {modelName} · /help for commands</Text>
      </Box>

      <Static key={staticKey} items={staticMessages}>
        {msg => (
          <MessageItem key={msg.id} message={msg} width={width} interactive={false} />
        )}
      </Static>

      <Box flexDirection="column">
        {activeMessages.map((msg, index) => (
          <MessageItem key={msg.id} message={msg} isFocused={index === focusedIndex} width={width} expanded={expandedMap[msg.id] ?? msg.role !== 'tool'} interactive={true} />
        ))}
        {isRunning && <LoadingIndicator />}
      </Box>

      <InputBox onSubmit={handleSend} disabled={isRunning || overlay.type !== 'none'} width={width} />

      {overlay.type === 'model' && (
        <CommandOverlay title="选择模型" width={modelW} left={Math.floor((width - modelW) / 2)}>
          <ModelPicker models={(overlay as any).models} activeId={(overlay as any).activeId} selectedIndex={pickerIndex} width={modelW} />
        </CommandOverlay>
      )}
      {overlay.type === 'role' && (
        <CommandOverlay title="选择角色" width={roleW} left={Math.floor((width - roleW) / 2)} titleColor="magenta">
          <RolePicker roles={(overlay as any).roles} currentRole={(overlay as any).currentRole} selectedIndex={pickerIndex} width={roleW} />
        </CommandOverlay>
      )}
      {overlay.type === 'sessions' && (
        <CommandOverlay title="恢复会话" width={sessionW} left={Math.floor((width - sessionW) / 2)} titleColor="yellow">
          <SessionPicker sessions={(overlay as any).sessions} selectedIndex={pickerIndex} width={sessionW} />
        </CommandOverlay>
      )}
      {overlay.type === 'help' && (
        <CommandOverlay title="帮助" width={helpW} left={Math.floor((width - helpW) / 2)} titleColor="green">
          <HelpOverlay width={helpW} />
        </CommandOverlay>
      )}
    </Box>
  );
}
