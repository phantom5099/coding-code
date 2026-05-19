export interface CommandDef {
  name: string;
  description: string;
  usage: string;
  title: string;
  quick?: boolean;
}

export const COMMAND_REGISTRY = {
  model:    { name: 'model',    description: '选择模型',      usage: '/model',    title: '选择模型' },
  sessions: { name: 'sessions', description: '恢复历史会话',   usage: '/sessions', title: '恢复会话' },
  help:     { name: 'help',     description: '显示帮助',      usage: '/help',     title: '帮助' },
  clear:    { name: 'clear',    description: '清空对话',      usage: '/clear',    title: '清空对话',  quick: true },
  exit:     { name: 'exit',     description: '退出',          usage: '/exit',     title: '退出',      quick: true },
} as const;

export type CommandName = keyof typeof COMMAND_REGISTRY;

export function parseCommand(input: string): { name: string; args: string } | null {
  if (!input.startsWith('/')) return null;
  const parts = input.slice(1).trim().split(/\s+/, 2);
  if (!parts[0]) return null;
  return { name: parts[0], args: parts[1] ?? '' };
}
