import { useState, useCallback, useEffect } from 'react';
import { Box, Static, useApp, useInput, Text } from 'ink';
import { useAgentRunner } from '../hooks/useAgentRunner.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { generateId, historyToUIMessages } from '../utils.js';
import type { PanelState } from '../types.js';
import type { StreamChunk, AgentClient } from '../index.js';
import { MessageItem } from './MessageItem.js';
import { InputBox } from './InputBox.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { InlinePanel } from './InlinePanel.js';
import { buildWelcomeContent } from './WelcomePanel.js';
import {
  COMMAND_REGISTRY,
  parseCommand,
  type CommandDef,
  type CommandName,
} from '../commands/registry.js';

const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: '默认 (逐次确认)',
  acceptEdits: '接受编辑 (自动允许文件操作)',
  plan: '计划模式 (只读)',
  bypass: '完全放行',
};
interface AppProps {
  client: AgentClient;
}

export function App({ client }: AppProps) {
  const { exit } = useApp();
  const { width } = useTerminalSize();
  const [sessionId, setSessionId] = useState('unknown');
  const runner = useCallback(
    (input: string) => client.sendMessage(input) as AsyncGenerator<StreamChunk>,
    [client]
  );
  const {
    staticMessages,
    activeMessages,
    setStaticMessages,
    setActiveMessages,
    run,
    isRunning,
    approval,
    setApproval,
  } = useAgentRunner(runner);
  const [panel, setPanel] = useState<PanelState>({ type: 'none' });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [staticKey, setStaticKey] = useState(0);
  const [permissionMode, setPermissionMode] = useState<string>('default');

  useEffect(() => {
    setStaticMessages([
      {
        id: generateId(),
        timestamp: Date.now(),
        role: 'welcome' as const,
        content: buildWelcomeContent(),
      },
    ]);
    setActiveMessages([]);
    client
      .getPermissionMode()
      .then(setPermissionMode)
      .catch(() => {});
  }, []); // only on mount

  useEffect(() => {
    if (activeMessages.length > 0) setFocusedIndex(activeMessages.length - 1);
    else setFocusedIndex(null);
  }, [activeMessages.length]);

  const handleSend = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      const parsed = parseCommand(trimmed);

      if (!parsed) {
        await run(trimmed);
        const sid = client.getSessionId();
        if (sid !== sessionId) {
          setSessionId(sid);
          setStaticMessages((prev) =>
            prev.map((m) => (m.role === 'welcome' ? { ...m, content: buildWelcomeContent() } : m))
          );
        }
        return;
      }

      const cmd: CommandDef | undefined = COMMAND_REGISTRY[parsed.name as CommandName];
      if (!cmd) {
        await run(trimmed);
        return;
      }

      if (cmd.quick) {
        if (parsed.name === 'exit') {
          exit();
          return;
        }
        if (parsed.name === 'clear') {
          setStaticMessages([
            {
              id: generateId(),
              timestamp: Date.now(),
              role: 'welcome' as const,
              content: buildWelcomeContent(),
            },
          ]);
          setActiveMessages([]);
          setStaticKey((k) => k + 1);
          return;
        }
        if (parsed.name === 'compact') {
          try {
            await client.compact();
            setStaticMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                timestamp: Date.now(),
                role: 'system' as const,
                content: '[Compact] 上下文已压缩',
              },
            ]);
          } catch (e: any) {
            setStaticMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                timestamp: Date.now(),
                role: 'system' as const,
                content: `[Compact Error] ${e.message || e}`,
              },
            ]);
          }
          return;
        }
        if (parsed.name === 'memory') {
          try {
            const arg = parsed.args.trim().toLowerCase();
            if (arg === 'on' || arg === 'off') {
              await client.setMemoryEnabled(arg === 'on');
              setStaticMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  timestamp: Date.now(),
                  role: 'system' as const,
                  content: `[Memory] 已${arg === 'on' ? '开启' : '关闭'}`,
                },
              ]);
            } else {
              const enabled = await client.getMemoryEnabled();
              setStaticMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  timestamp: Date.now(),
                  role: 'system' as const,
                  content: `[Memory] 当前: ${enabled ? '开启' : '关闭'}  用法: /memory on|off`,
                },
              ]);
            }
          } catch (e: any) {
            setStaticMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                timestamp: Date.now(),
                role: 'system' as const,
                content: `[Memory Error] ${e.message || e}`,
              },
            ]);
          }
          return;
        }
        if (parsed.name === 'subagent') {
          try {
            const arg = parsed.args.trim().toLowerCase();
            if (arg === 'on' || arg === 'off') {
              await client.setSubagentEnabled({ enabled: arg === 'on', cwd: '' });
              setStaticMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  timestamp: Date.now(),
                  role: 'system' as const,
                  content: `[Subagent] 已${arg === 'on' ? '开启' : '关闭'}`,
                },
              ]);
            } else {
              const result = await client.getSubagentEnabled({ cwd: '' });
              const enabled = result.enabled;
              setStaticMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  timestamp: Date.now(),
                  role: 'system' as const,
                  content: `[Subagent] 当前: ${enabled ? '开启' : '关闭'}  用法: /subagent on|off`,
                },
              ]);
            }
          } catch (e: any) {
            setStaticMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                timestamp: Date.now(),
                role: 'system' as const,
                content: `[Subagent Error] ${e.message || e}`,
              },
            ]);
          }
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
        } catch {
          /* ignore - server may not be ready */
        }
        return;
      }
      if (parsed.name === 'sessions') {
        try {
          const sessions = await client.listSessions();
          setPanel({
            type: 'sessions',
            items: sessions.map((s: any) => ({
              label: `${s.title || s.sessionId.slice(0, 8)}  ${new Date(s.createdAt).toLocaleString()}`,
              value: s.sessionId,
            })),
          });
        } catch {
          /* ignore */
        }
        return;
      }
      if (parsed.name === 'checkpoint') {
        try {
          const checkpoints = await client.getCheckpoints();
          setPanel({ type: 'checkpoint-list', checkpoints });
        } catch (e: any) {
          setStaticMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              timestamp: Date.now(),
              role: 'system' as const,
              content: `[Checkpoint Error] ${e.message || e}`,
            },
          ]);
          return;
        }
        return;
      }
      if (parsed.name === 'help') {
        setPanel({ type: 'help' });
        return;
      }
      if (parsed.name === 'mcp') {
        try {
          const servers = await client.getMcpStatus();
          setPanel({ type: 'mcp', servers });
        } catch (e: any) {
          setStaticMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              timestamp: Date.now(),
              role: 'system' as const,
              content: `[MCP Error] ${e.message || e}`,
            },
          ]);
        }
        return;
      }
      if (parsed.name === 'skill') {
        try {
          const skills = await client.listSkills();
          setPanel({ type: 'skill', skills });
        } catch (e: any) {
          setStaticMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              timestamp: Date.now(),
              role: 'system' as const,
              content: `[Skill Error] ${e.message || e}`,
            },
          ]);
        }
        return;
      }
      if (parsed.name === 'approve') {
        try {
          const mode = await client.getPermissionMode();
          setPermissionMode(mode);
          setPanel({ type: 'permission', currentMode: mode });
        } catch (e: any) {
          setStaticMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              timestamp: Date.now(),
              role: 'system' as const,
              content: `[Approve Error] ${e.message || e}`,
            },
          ]);
        }
        return;
      }
    },
    [client, run, exit, sessionId]
  );

  // 审批面板：用户选择后发送响应
  const handleApprovalResponse = useCallback(
    async (response: string) => {
      if (!approval) return;
      await client.sendApprovalResponse(approval.id, response);
      approval.resolve(response);
    },
    [approval, client]
  );

  useInput((input, key) => {
    // 审批面板激活时，键盘由 InlinePanel 处理
    if (approval) return;

    if (panel.type === 'help') {
      if (key.escape) setPanel({ type: 'none' });
      return;
    }
    if (panel.type !== 'none') return;

    if (key.upArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex((prev) =>
        prev === null || prev <= 0 ? activeMessages.length - 1 : prev - 1
      );
      return;
    }
    if (key.downArrow) {
      if (activeMessages.length === 0) return;
      setFocusedIndex((prev) =>
        prev === null || prev >= activeMessages.length - 1 ? 0 : prev + 1
      );
      return;
    }
    if (key.ctrl && input === 'o' && focusedIndex !== null) {
      const msg = activeMessages[focusedIndex];
      if (msg) setExpandedMap((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }));
    }
  });

  const modelW = Math.min(60, width - 4);
  const sessionW = Math.min(70, width - 4);
  const helpW = Math.min(50, width - 4);
  const helpInnerW = Math.max(1, helpW - 2);

  return (
    <Box flexDirection="column">
      <Static key={staticKey} items={staticMessages}>
        {(msg) => <MessageItem key={msg.id} message={msg} width={width} interactive={false} />}
      </Static>

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
        {isRunning && !approval && <LoadingIndicator />}
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
      {panel.type === 'sessions' && (
        <InlinePanel
          title={COMMAND_REGISTRY.sessions.title}
          items={panel.items}
          onSelect={async (value) => {
            const history = await client.resumeSession(value);
            const uiMsgs = historyToUIMessages(history);
            setStaticMessages(uiMsgs);
            setSessionId(value);
            setPanel({ type: 'none' });
            setStaticKey((k) => k + 1);
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={sessionW}
        />
      )}
      {panel.type === 'checkpoint-list' && (
        <InlinePanel
          title={COMMAND_REGISTRY.checkpoint.title}
          items={
            panel.checkpoints.length === 0
              ? [{ label: '无已完成的检查点', value: '' as const }]
              : panel.checkpoints.map((cp) => ({
                  label: `${cp.title || '(无标题)'}  ${cp.agentModified.length + cp.unknownSource.length} 个文件`,
                  value: cp.turnId.toString(),
                }))
          }
          onSelect={async (value) => {
            const cp = panel.checkpoints.find((c) => c.turnId.toString() === value);
            if (!cp) return;
            const hasForward = await client.hasForwardStack();
            setPanel({ type: 'checkpoint-action', cp, hasForward });
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={Math.min(60, width - 4)}
        />
      )}
      {panel.type === 'checkpoint-action' && (
        <InlinePanel
          title={`${COMMAND_REGISTRY.checkpoint.title} — ${panel.cp.title || '(无标题)'}`}
          items={[
            ...(panel.cp.agentModified.length + panel.cp.unknownSource.length > 0
              ? [
                  {
                    label: `仅回退 Agent 修改的文件 (${panel.cp.agentModified.length} 个)`,
                    value: 'agent' as const,
                  },
                  {
                    label: `回退全部文件 (${panel.cp.agentModified.length + panel.cp.unknownSource.length} 个)`,
                    value: 'all' as const,
                  },
                ]
              : [{ label: '无变更文件', value: '' as const }]),
            ...(panel.hasForward ? [{ label: '前进到最新状态', value: 'forward' as const }] : []),
          ]}
          onSelect={async (value) => {
            if (value === 'forward') {
              await client.forwardLastRevert();
            } else if (value === 'agent' || value === 'all') {
              await client.revertCheckpoint(panel.cp.turnId, value);
            }
            setPanel({ type: 'none' });
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={Math.min(60, width - 4)}
        />
      )}
      {approval && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginY={1}
        >
          <Box>
            <Text bold color="yellow">
              🔒 审批请求 —{' '}
            </Text>
            <Text bold>{approval.tool}</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {Object.entries(approval.args).map(([k, v]) => (
              <Box key={k}>
                <Text color="gray"> {k}: </Text>
                <Text>{String(v).slice(0, 150)}</Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">{'─'.repeat(Math.min(40, width - 6))}</Text>
          </Box>
          <InlinePanel
            title="选择操作"
            items={[
              { label: '✅ 允许 (Allow)', value: 'allow' as const },
              { label: '❌ 拒绝 (Deny)', value: 'deny' as const },
              { label: '⭐ 总是允许 (Always)', value: 'always' as const },
              { label: '🚫 永不 (Never)', value: 'never' as const },
            ]}
            onSelect={async (value) => {
              await client.sendApprovalResponse(approval.id, value);
              approval.resolve(value);
            }}
            onCancel={() => handleApprovalResponse('deny')}
            width={Math.min(50, width - 4)}
          />
        </Box>
      )}
      {panel.type === 'mcp' && (
        <InlinePanel
          title={COMMAND_REGISTRY.mcp.title}
          items={
            panel.servers.length === 0
              ? [{ label: '无已配置的 MCP 服务器', value: '' }]
              : panel.servers.map((s) => ({
                  label: `${s.disabled ? '○' : '●'} ${s.name}  (${s.disabled ? '已禁用' : `已连接, ${s.toolCount} 个工具`})`,
                  value: s.name,
                }))
          }
          onSelect={async (value) => {
            if (!value) return;
            const server = panel.servers.find((s) => s.name === value);
            if (!server) return;
            try {
              if (server.disabled) {
                await client.setMcpDisabled({ name: value, disabled: false, cwd: '' });
              } else {
                await client.setMcpDisabled({ name: value, disabled: true, cwd: '' });
              }
              const updated = await client.getMcpStatus();
              setPanel({ type: 'mcp', servers: updated });
            } catch {
              setPanel({ type: 'none' });
            }
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={Math.min(60, width - 4)}
        />
      )}
      {panel.type === 'skill' && (
        <InlinePanel
          title={COMMAND_REGISTRY.skill.title}
          items={
            panel.skills.length === 0
              ? [{ label: '无已加载的 Skill', value: '' }]
              : panel.skills.map((s) => ({
                  label: `${s.enabled ? '✓' : '✗'} ${s.name}  ${s.description}`,
                  value: s.name,
                }))
          }
          onSelect={async (value) => {
            if (!value) return;
            const skill = panel.skills.find((s) => s.name === value);
            if (!skill) return;
            try {
              await client.toggleSkill({ name: value, enabled: !skill.enabled, cwd: '' });
              const updated = await client.listSkills();
              setPanel({ type: 'skill', skills: updated });
            } catch {
              setPanel({ type: 'none' });
            }
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={Math.min(70, width - 4)}
        />
      )}
      {panel.type === 'permission' && (
        <InlinePanel
          title={COMMAND_REGISTRY.approve.title}
          items={[
            {
              label: `${panel.currentMode === 'default' ? '●' : '○'} 默认 — 逐次确认`,
              value: 'default',
            },
            {
              label: `${panel.currentMode === 'acceptEdits' ? '●' : '○'} 接受编辑 — 自动允许文件操作`,
              value: 'acceptEdits',
            },
            {
              label: `${panel.currentMode === 'plan' ? '●' : '○'} 计划模式 — 仅只读`,
              value: 'plan',
            },
            { label: `${panel.currentMode === 'bypass' ? '●' : '○'} 完全放行`, value: 'bypass' },
          ]}
          activeValue={panel.currentMode}
          onSelect={async (value) => {
            if (!value) return;
            try {
              await client.setPermissionMode(value as any);
              setPermissionMode(value);
            } catch {
              /* ignore */
            }
            setPanel({ type: 'none' });
          }}
          onCancel={() => setPanel({ type: 'none' })}
          width={Math.min(60, width - 4)}
        />
      )}
      {panel.type === 'help' && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="green"
          width={helpW}
          paddingX={1}
        >
          <Box>
            <Text bold color="green">
              {COMMAND_REGISTRY.help.title}
            </Text>
          </Box>
          <Box>
            <Text color="gray">{'─'.repeat(helpInnerW)}</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold>命令:</Text>
            {Object.values(COMMAND_REGISTRY).map((cmd) => (
              <Box key={cmd.name} paddingLeft={2}>
                <Text color="gray">
                  {cmd.usage.padEnd(12)}
                  {cmd.description}
                </Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text bold>快捷键:</Text>
          </Box>
          <Box paddingLeft={2} flexDirection="column">
            <Text color="gray">↑/↓ 聚焦消息</Text>
            <Text color="gray">Ctrl+O 展开/折叠消息</Text>
          </Box>
          <Box>
            <Text color="gray">{'─'.repeat(helpInnerW)}</Text>
          </Box>
          <Box>
            <Text color="gray">Esc 关闭</Text>
          </Box>
        </Box>
      )}

      <Box paddingLeft={2} marginBottom={0}>
        <Text color="gray">○ {PERMISSION_MODE_LABELS[permissionMode] ?? permissionMode}</Text>
      </Box>
      <InputBox onSubmit={handleSend} disabled={isRunning || panel.type !== 'none'} width={width} />
    </Box>
  );
}
