import { useState, useCallback, useEffect } from 'react';
import { Box, Static, useApp, useInput, Text } from 'ink';
import { useAgentRunner } from '../hooks/useAgentRunner.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { generateId } from '../utils.js';
import type { PanelState } from '../types.js';
import { MessageItem } from './MessageItem.js';
import { InputBox } from './InputBox.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { InlinePanel } from './InlinePanel.js';
import { buildWelcomeContent } from './WelcomePanel.js';
import { COMMAND_REGISTRY, parseCommand, type CommandDef, type CommandName } from '../commands/registry.js';

interface AppProps {
  client: Record<string, any>;
}

export function App({ client }: AppProps) {
  const { exit } = useApp();
  const { width } = useTerminalSize();
  const [sessionId, setSessionId] = useState('unknown');
  const [currentRole, setCurrentRole] = useState('coder');
  const runner = useCallback(
    (input: string) => client.sendMessage(input),
    [client],
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
  const [panel, setPanel] = useState<PanelState>({ type: 'none' });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [staticKey, setStaticKey] = useState(0);

  useEffect(() => {
    const uiMsgs = [{
      id: generateId(), timestamp: Date.now(), role: 'welcome' as const,
      content: buildWelcomeContent({ model: 'unknown', role: currentRole, sessionId }),
    }];
    setStaticMessages(uiMsgs);
    setActiveMessages([]);
  }, [sessionId, currentRole, setStaticMessages, setActiveMessages]);

  useEffect(() => {
    if (activeMessages.length > 0) setFocusedIndex(activeMessages.length - 1);
    else setFocusedIndex(null);
  }, [activeMessages.length]);

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const parsed = parseCommand(trimmed);

    if (!parsed) {
      await run(trimmed);
      const sid = client.getSessionId();
      if (sid !== sessionId) setSessionId(sid);
      return;
    }

    const cmd: CommandDef | undefined = COMMAND_REGISTRY[parsed.name as CommandName];
    if (!cmd) {
      await run(trimmed);
      return;
    }

    if (cmd.quick) {
      if (parsed.name === 'exit') { exit(); return; }
      if (parsed.name === 'clear') {
        await client.clearSession();
        clearMessages();
        setStaticKey(k => k + 1);
        return;
      }
      return;
    }

    if (parsed.name === 'model') {
      try {
        const { models, activeId } = await client.listModels();
        setPanel({
          type: 'model',
          items: models.map((m: any) => ({
            label: m.name || m.id,
            value: m.id,
            description: `${m.provider}/${m.model}`,
          })),
          activeValue: activeId,
        });
      } catch { /* ignore - server may not be ready */ }
      return;
    }
    if (parsed.name === 'role') {
      try {
        const { roles, currentRole: cr } = await client.listRoles();
        setPanel({
          type: 'role',
          items: roles.map((r: any) => ({
            label: r.label || r.id,
            value: r.id,
            description: r.description || '',
          })),
          activeValue: cr,
        });
      } catch { /* ignore */ }
      return;
    }
    if (parsed.name === 'sessions') {
      try {
        const sessions = await client.listSessions();
        setPanel({
          type: 'sessions',
          items: sessions.map((s: any) => ({
            label: `${s.sessionId.slice(0, 8)} (${s.messageCount} msgs)`,
            value: s.sessionId,
            description: `${s.model} ${s.role} - ${new Date(s.createdAt).toLocaleString()}`,
          })),
        });
      } catch { /* ignore */ }
      return;
    }
    if (parsed.name === 'help') {
      setPanel({ type: 'help' });
      return;
    }
  }, [client, run, exit, clearMessages, sessionId]);

  useInput((_input, key) => {
    if (panel.type === 'help') {
      if (key.escape) setPanel({ type: 'none' });
      return;
    }
    if (panel.type !== 'none') return;

    if (key.upArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex(prev => (prev === null || prev <= 0) ? activeMessages.length - 1 : prev - 1);
      return;
    }
    if (key.downArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex(prev => (prev === null || prev >= activeMessages.length - 1) ? 0 : prev + 1);
      return;
    }
    if (key.ctrl && _input === 'o' && focusedIndex !== null) {
      const msg = activeMessages[focusedIndex];
      if (msg) setExpandedMap(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
    }
  });

  const modelW = Math.min(60, width - 4);
  const roleW = Math.min(60, width - 4);
  const sessionW = Math.min(70, width - 4);
  const helpW = Math.min(50, width - 4);
  const helpInnerW = Math.max(1, helpW - 2);

  return (
    <Box flexDirection="column">
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

      {panel.type === 'model' && (
        <InlinePanel
          title={COMMAND_REGISTRY.model.title}
          items={panel.items}
          activeValue={panel.activeValue}
          onSelect={async (value) => {
            await client.switchModel(value);
            setPanel({ type: 'none' });
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={modelW}
        />
      )}
      {panel.type === 'role' && (
        <InlinePanel
          title={COMMAND_REGISTRY.role.title}
          items={panel.items}
          activeValue={panel.activeValue}
          onSelect={async (value) => {
            await client.switchRole(value);
            setCurrentRole(value);
            setPanel({ type: 'none' });
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={roleW}
        />
      )}
      {panel.type === 'sessions' && (
        <InlinePanel
          title={COMMAND_REGISTRY.sessions.title}
          items={panel.items}
          onSelect={async (value) => {
            await client.resumeSession(value);
            setSessionId(value);
            setPanel({ type: 'none' });
            setStaticKey(k => k + 1);
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={sessionW}
        />
      )}
      {panel.type === 'help' && (
        <Box flexDirection="column" borderStyle="single" borderColor="green" width={helpW} paddingX={1}>
          <Box>
            <Text bold color="green">{COMMAND_REGISTRY.help.title}</Text>
          </Box>
          <Box><Text color="gray">{'─'.repeat(helpInnerW)}</Text></Box>
          <Box flexDirection="column">
            <Text bold>命令:</Text>
            {Object.values(COMMAND_REGISTRY).map(cmd => (
              <Box key={cmd.name} paddingLeft={2}>
                <Text color="gray">{cmd.usage.padEnd(12)}{cmd.description}</Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text bold>快捷键:</Text>
          </Box>
          <Box paddingLeft={2} flexDirection="column">
            <Text color="gray">↑/↓        聚焦消息</Text>
            <Text color="gray">Ctrl+O     展开/折叠消息</Text>
          </Box>
          <Box><Text color="gray">{'─'.repeat(helpInnerW)}</Text></Box>
          <Box>
            <Text color="gray">Esc 关闭</Text>
          </Box>
        </Box>
      )}

      <InputBox onSubmit={handleSend} disabled={isRunning || panel.type !== 'none'} width={width} />
    </Box>
  );
}
