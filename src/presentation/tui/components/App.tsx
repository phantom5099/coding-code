import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import type { Agent } from '../../../agent/agent';
import { SessionStore } from '../../../session/store';
import { getActiveEntry, listModels, switchModel } from '../../../llm/factory';
import { listRoles } from '../../../prompts';
import {
  getGlobalRules,
  getProjectRules,
  clearGlobalRules,
  clearProjectRules,
} from '../../../rules';
import type { SessionIndex } from '../../../session/types';
import { useAgentRunner } from '../hooks/useAgentRunner';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { historyToUIMessages, generateId } from '../utils';
import type { OverlayState } from '../types';
import { MessageItem } from './MessageItem';
import { InputBox } from './InputBox';
import { LoadingIndicator } from './LoadingIndicator';
import { CommandOverlay } from './CommandOverlay';
import { ModelPicker } from './ModelPicker';
import { RolePicker } from './RolePicker';
import { SessionPicker } from './SessionPicker';
import { HelpOverlay } from './HelpOverlay';
import { buildWelcomeContent } from './WelcomePanel';

interface AppProps {
  agent: Agent;
  sessionStore: SessionStore;
}

export function App({ agent, sessionStore }: AppProps) {
  const { exit } = useApp();
  const { width, height } = useTerminalSize();
  const {
    staticMessages,
    activeMessages,
    setStaticMessages,
    setActiveMessages,
    run,
    isRunning,
    clearMessages,
  } = useAgentRunner(agent);
  const [overlay, setOverlay] = useState<OverlayState>({ type: 'none' });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [pickerIndex, setPickerIndex] = useState(0);
  const [staticKey, setStaticKey] = useState(0);

  // 覆盖层切换时重置选择位置
  useEffect(() => {
    if (overlay.type !== 'none') {
      setPickerIndex(0);
    }
  }, [overlay.type]);

  // 初始化加载历史到 static
  useEffect(() => {
    const history = sessionStore.readHistory();
    let uiMessages = historyToUIMessages(history);

    // 新会话无历史时，添加欢迎面板到 scrollback
    if (uiMessages.length === 0) {
      const entry = getActiveEntry();
      uiMessages = [{
        id: generateId(),
        timestamp: Date.now(),
        role: 'welcome' as const,
        content: buildWelcomeContent({
          model: entry.ok ? entry.value.name : 'unknown',
          role: agent.getRole(),
          sessionId: sessionStore.getSessionId(),
        }),
      }];
    }

    setStaticMessages(uiMessages);
    setActiveMessages([]);
  }, [sessionStore, setStaticMessages, setActiveMessages, agent]);

  // active 消息变化时聚焦到最后一条
  useEffect(() => {
    if (activeMessages.length > 0) {
      setFocusedIndex(activeMessages.length - 1);
    } else {
      setFocusedIndex(null);
    }
  }, [activeMessages.length]);

  const handleClear = useCallback(() => {
    agent.clearContext();
    const newStore = new SessionStore(process.cwd());
    const entry = getActiveEntry();
    if (entry.ok) {
      newStore.init(entry.value.model, agent.getRole(), '0.1.0');
    }
    Object.assign(sessionStore, newStore);
    clearMessages();
    setStaticKey(k => k + 1);
  }, [agent, sessionStore, clearMessages]);

  const handleResumeSession = useCallback((session: SessionIndex) => {
    const newStore = new SessionStore(session.cwd, session.sessionId);
    const msgs = newStore.readMessages();

    switchModel(session.model);
    agent.switchRole(session.role);
    agent.clearContext();
    agent.setMessages(msgs);

    Object.assign(sessionStore, newStore);

    const history = newStore.readHistory();
    const uiMessages = historyToUIMessages(history);
    setStaticMessages(uiMessages);
    setActiveMessages([]);
    setOverlay({ type: 'none' });
    setStaticKey(k => k + 1);
  }, [agent, sessionStore, setStaticMessages, setActiveMessages]);

  const handleSend = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === '/exit') {
      exit();
      return;
    }

    if (trimmed === '/clear') {
      handleClear();
      return;
    }

    if (trimmed === '/help') {
      setOverlay({ type: 'help' });
      return;
    }

    if (trimmed === '/model') {
      const models = listModels();
      if (models.ok) {
        const active = getActiveEntry();
        setOverlay({ type: 'model', models: models.value, activeId: active.ok ? active.value.id : '' });
      }
      return;
    }

    if (trimmed === '/role') {
      const roles = listRoles();
      setOverlay({ type: 'role', roles, currentRole: agent.getRole() });
      return;
    }

    if (trimmed === '/sessions') {
      const sessions = SessionStore.listSessions();
      setOverlay({ type: 'sessions', sessions });
      return;
    }

    if (trimmed === '/debug') {
      const entry = getActiveEntry();
      const info = [
        `Role: ${agent.getRole()}`,
        `Model: ${entry.ok ? entry.value.name : 'unknown'}`,
        `Session: ${sessionStore.getSessionId().slice(0, 8)}`,
        `Messages: ${sessionStore.getMessageCount()}`,
      ];
      setStaticMessages(prev => [...prev, {
        id: generateId(),
        timestamp: Date.now(),
        role: 'system',
        content: info.join(' | '),
      }]);
      return;
    }

    if (trimmed.startsWith('/rules')) {
      const args = trimmed.slice('/rules'.length).trim();
      if (args === 'show') {
        const global = getGlobalRules();
        const project = getProjectRules();
        const lines: string[] = ['── Rules ──'];
        lines.push(`Global: ${global ? global.slice(0, 200) : '(empty)'}`);
        lines.push(`Project: ${project ? project.slice(0, 200) : '(empty)'}`);
        setStaticMessages(prev => [...prev, {
          id: generateId(),
          timestamp: Date.now(),
          role: 'system',
          content: lines.join('\n'),
        }]);
      } else if (args.startsWith('clear')) {
        const scope = args.includes('global') ? 'global' : args.includes('project') ? 'project' : null;
        if (scope === 'global') {
          clearGlobalRules();
          setStaticMessages(prev => [...prev, { id: generateId(), timestamp: Date.now(), role: 'system', content: 'Global rules cleared.' }]);
        } else if (scope === 'project') {
          clearProjectRules();
          setStaticMessages(prev => [...prev, { id: generateId(), timestamp: Date.now(), role: 'system', content: 'Project rules cleared.' }]);
        } else {
          setStaticMessages(prev => [...prev, { id: generateId(), timestamp: Date.now(), role: 'system', content: 'Usage: /rules clear global|project' }]);
        }
      } else {
        setStaticMessages(prev => [...prev, { id: generateId(), timestamp: Date.now(), role: 'system', content: 'Usage: /rules show | /rules clear global|project' }]);
      }
      return;
    }

    await run(trimmed);
  }, [agent, run, exit, setStaticMessages, handleClear, sessionStore]);

  // ====== 统一键盘处理 ======
  useInput((input, key) => {
    const overlayType = overlay.type;

    if (overlayType !== 'none') {
      // Escape: 关闭覆盖层
      if (key.escape) {
        setOverlay({ type: 'none' });
        return;
      }

      // 获取当前覆盖层的项目数量
      const itemCount =
        overlayType === 'model' ? overlay.models.length :
        overlayType === 'role' ? overlay.roles.length :
        overlayType === 'sessions' ? overlay.sessions.length : 0;

      // Help 覆盖层没有选择项，仅支持 Escape 关闭
      if (overlayType === 'help') return;

      if (key.upArrow) {
        setPickerIndex(prev => (prev <= 0 ? itemCount - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setPickerIndex(prev => (prev >= itemCount - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && itemCount > 0) {
        if (overlayType === 'model') {
          switchModel(overlay.models[pickerIndex]!.id);
          setOverlay({ type: 'none' });
        } else if (overlayType === 'role') {
          agent.switchRole(overlay.roles[pickerIndex]!.id);
          setOverlay({ type: 'none' });
        } else if (overlayType === 'sessions') {
          handleResumeSession(overlay.sessions[pickerIndex]!);
        }
        return;
      }
      return;
    }

    // ── 主界面模式：无覆盖层 ──
    if (key.upArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex(prev => {
        if (prev === null || prev <= 0) return activeMessages.length - 1;
        return prev - 1;
      });
      return;
    }
    if (key.downArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex(prev => {
        if (prev === null || prev >= activeMessages.length - 1) return 0;
        return prev + 1;
      });
      return;
    }
    if (key.ctrl && input === 'o') {
      if (focusedIndex !== null) {
        const msg = activeMessages[focusedIndex];
        if (msg) {
          setExpandedMap(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
        }
      }
    }
  });

  const bannerEntry = getActiveEntry();
  const modelW = Math.min(60, width - 4);
  const roleW = Math.min(60, width - 4);
  const sessionW = Math.min(70, width - 4);
  const helpW = Math.min(50, width - 4);

  return (
    <Box flexDirection="column" height={height}>
      <Box>
        <Text bold color="cyan">coding-agent</Text>
        <Text color="gray" dimColor>  {bannerEntry.ok ? bannerEntry.value.name : 'unknown'} · /help for commands</Text>
      </Box>

      {/* Static 区域：已完成的消息永久保留在终端 scrollback */}
      <Static key={staticKey} items={staticMessages}>
        {msg => (
          <MessageItem
            key={msg.id}
            message={msg}
            width={width}
            interactive={false}
          />
        )}
      </Static>

      {/* 动态区域：只有当前消息支持交互 */}
      <Box flexDirection="column">
        {activeMessages.map((msg, index) => (
          <MessageItem
            key={msg.id}
            message={msg}
            isFocused={index === focusedIndex}
            width={width}
            expanded={expandedMap[msg.id] ?? msg.role !== 'tool'}
            interactive={true}
          />
        ))}
        {isRunning && <LoadingIndicator />}
      </Box>

      <InputBox onSubmit={handleSend} disabled={isRunning || overlay.type !== 'none'} width={width} />

      {overlay.type === 'model' && (
        <CommandOverlay
          title="选择模型"
          width={modelW}
          left={Math.floor((width - modelW) / 2)}
        >
          <ModelPicker
            models={overlay.models}
            activeId={overlay.activeId}
            selectedIndex={pickerIndex}
            width={modelW}
          />
        </CommandOverlay>
      )}

      {overlay.type === 'role' && (
        <CommandOverlay
          title="选择角色"
          width={roleW}
          left={Math.floor((width - roleW) / 2)}
          titleColor="magenta"
        >
          <RolePicker
            roles={overlay.roles}
            currentRole={overlay.currentRole}
            selectedIndex={pickerIndex}
            width={roleW}
          />
        </CommandOverlay>
      )}

      {overlay.type === 'sessions' && (
        <CommandOverlay
          title="恢复会话"
          width={sessionW}
          left={Math.floor((width - sessionW) / 2)}
          titleColor="yellow"
        >
          <SessionPicker
            sessions={overlay.sessions}
            selectedIndex={pickerIndex}
            width={sessionW}
          />
        </CommandOverlay>
      )}

      {overlay.type === 'help' && (
        <CommandOverlay
          title="帮助"
          width={helpW}
          left={Math.floor((width - helpW) / 2)}
          titleColor="green"
        >
          <HelpOverlay width={helpW} />
        </CommandOverlay>
      )}
    </Box>
  );
}
