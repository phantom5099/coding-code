export interface CommandDef {
  name: string;
  description: string;
  usage: string;
  title: string;
  quick?: boolean;
}

export const COMMAND_REGISTRY = {
  model: { name: 'model', description: '选择模型', usage: '/model', title: '选择模型' },
  sessions: {
    name: 'sessions',
    description: '恢复历史会话',
    usage: '/sessions',
    title: '恢复会话',
  },
  checkpoint: {
    name: 'checkpoint',
    description: '管理文件快照，回退/前进',
    usage: '/checkpoint',
    title: '检查点',
  },
  help: { name: 'help', description: '显示帮助', usage: '/help', title: '帮助' },
  clear: {
    name: 'clear',
    description: '清空对话',
    usage: '/clear',
    title: '清空对话',
    quick: true,
  },
  exit: { name: 'exit', description: '退出', usage: '/exit', title: '退出', quick: true },
  compact: {
    name: 'compact',
    description: '手动压缩上下文',
    usage: '/compact',
    title: '压缩上下文',
    quick: true,
  },
  memory: {
    name: 'memory',
    description: '查看/切换 Memory',
    usage: '/memory [on|off]',
    title: 'Memory',
    quick: true,
  },
  subagent: {
    name: 'subagent',
    description: '查看/切换 Subagent',
    usage: '/subagent [on|off]',
    title: 'Subagent',
    quick: true,
  },
  mcp: { name: 'mcp', description: '管理 MCP 服务器', usage: '/mcp', title: 'MCP 服务器' },
  skill: { name: 'skill', description: '管理 Skill', usage: '/skill', title: 'Skill' },
  approve: {
    name: 'approve',
    description: '切换工具审批模式',
    usage: '/approve',
    title: '审批模式',
  },
} as const;

export type CommandName = keyof typeof COMMAND_REGISTRY;

export function parseCommand(input: string): { name: string; args: string } | null {
  if (!input.startsWith('/')) return null;
  const parts = input.slice(1).trim().split(/\s+/, 2);
  if (!parts[0]) return null;
  return { name: parts[0], args: parts[1] ?? '' };
}
