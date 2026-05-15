import { getActiveEntry, listModels, switchModel, type SelectableModel } from '../../llm/factory';
import { listRoles } from '../../prompts';
import type { Agent } from '../../agent/agent';
import { SessionStore } from '../../session/store';
import type { Message } from '../../core/types';
import {
  getGlobalRules,
  getProjectRules,
  clearGlobalRules,
  clearProjectRules,
  editGlobalRules,
  editProjectRules,
} from '../../rules';
import { c, writeln, normalPrompt, showBanner, showModelSelection, showRoleSelection, showRulesSelection, showHelp } from './renderer';

export type CommandHandler = (args: string, agent: Agent, sessionStore: SessionStore) => Promise<void> | void;

export interface CommandContext {
  agent: Agent;
  sessionStore: SessionStore;
  onModelChange?: () => void;
  onSessionReset?: () => void;
}

export const commands: Record<string, (ctx: CommandContext, args: string) => Promise<void> | void> = {
  '/model': handleModel,
  '/m': handleModel,
  '/role': handleRole,
  '/r': handleRole,
  '/rules': handleRules,
  '/sessions': handleSessions,
  '/help': handleHelp,
  '/h': handleHelp,
  '/clear': handleClear,
  '/debug': handleDebug,
  '/exit': handleExit,
  '/e': handleExit,
  '/q': handleExit,
};

let selectingModel = false;
let selectingRole = false;
let selectingRules = false;
let selectingSession = false;
let pendingSessions: import('../../session/types').SessionIndex[] = [];
let pendingCallback: ((value: string) => void) | null = null;

export function isSelecting(): boolean {
  return selectingModel || selectingRole || selectingRules || selectingSession;
}

export function handleSelectionInput(input: string, ctx: CommandContext): boolean {
  if (selectingModel) {
    selectingModel = false;
    const models = listModels();
    if (!models.ok) {
      writeln(`${c.red}${models.error.message}${c.reset}`);
      normalPrompt();
      return true;
    }
    if (!input) {
      writeln(`${c.dim}Cancelled.${c.reset}`);
      normalPrompt();
      return true;
    }
    const num = Number(input);
    if (isNaN(num) || num < 1 || num > models.value.length) {
      writeln(`${c.red}Type a number 1-${models.value.length}, or Enter to cancel${c.reset}`);
      selectingModel = true;
      return true;
    }
    const entry = models.value[num - 1]!;
    const switched = switchModel(entry.id);
    if (!switched.ok) {
      writeln(`${c.red}${switched.error.message}${c.reset}`);
    } else {
      writeln(`${c.green}Switched to:${c.reset} ${c.bold}${switched.value.name}${c.reset}`);
      ctx.onModelChange?.();
    }
    normalPrompt();
    return true;
  }

  if (selectingRole) {
    selectingRole = false;
    const roles = listRoles();
    if (!input) {
      writeln(`${c.dim}Cancelled.${c.reset}`);
      normalPrompt();
      return true;
    }
    const num = Number(input);
    if (isNaN(num) || num < 1 || num > roles.length) {
      writeln(`${c.red}Type a number 1-${roles.length}, or Enter to cancel${c.reset}`);
      selectingRole = true;
      return true;
    }
    const role = roles[num - 1]!;
    ctx.agent.switchRole(role.id);
    writeln(`${c.green}Switched role to:${c.reset} ${c.bold}${role.label}${c.reset} ${c.dim}(${role.description})${c.reset}`);
    normalPrompt();
    return true;
  }

  if (selectingRules) {
    selectingRules = false;
    if (!input) {
      writeln(`${c.dim}Cancelled.${c.reset}`);
      normalPrompt();
      return true;
    }
    const num = Number(input);
    if (isNaN(num) || num < 1 || num > 2) {
      writeln(`${c.red}Type 1 or 2, or Enter to cancel${c.reset}`);
      selectingRules = true;
      return true;
    }
    const scope = num === 1 ? 'global' : 'project';
    writeln(`${c.dim}Opening ${scope} rules in editor...${c.reset}`);
    const ok = scope === 'global' ? editGlobalRules() : editProjectRules();
    if (ok) {
      writeln(`${c.green}${scope} rules opened in editor.${c.reset}`);
    } else {
      writeln(`${c.red}Editor failed.${c.reset}`);
    }
    normalPrompt();
    return true;
  }

  if (selectingSession) {
    selectingSession = false;
    const sorted = pendingSessions;
    if (!input) {
      writeln(`${c.dim}Cancelled.${c.reset}`);
      normalPrompt();
      return true;
    }
    const num = Number(input);
    if (isNaN(num) || num < 1 || num > sorted.length) {
      writeln(`${c.red}Type a number 1-${sorted.length}, or Enter to cancel${c.reset}`);
      selectingSession = true;
      return true;
    }
    const session = sorted[num - 1]!;

    // 创建目标会话的 SessionStore
    const newStore = new SessionStore(session.cwd, session.sessionId);
    const messages = newStore.readMessages();

    // 切换模型
    const switched = switchModel(session.model);
    if (switched.ok) {
      writeln(`${c.green}Switched to:${c.reset} ${c.bold}${switched.value.name}${c.reset}`);
    } else {
      writeln(`${c.yellow}Model "${session.model}" not available, keeping current${c.reset}`);
    }

    // 切换角色
    ctx.agent.switchRole(session.role);

    // 加载历史消息
    ctx.agent.clearContext();
    ctx.agent.setMessages(messages);

    // 替换 session store
    Object.assign(ctx.sessionStore, newStore);
    ctx.onSessionReset?.();

    writeln(
      `${c.green}Session resumed:${c.reset} ${c.bold}${session.sessionId.slice(0, 8)}${c.reset} ` +
        `${c.dim}(model=${session.model}, role=${session.role}, ${messages.length} msgs)${c.reset}`,
    );
    normalPrompt();
    return true;
  }

  return false;
}

function handleModel(ctx: CommandContext, _args: string) {
  const models = listModels();
  if (!models.ok) {
    writeln(`${c.red}${models.error.message}${c.reset}`);
    return;
  }
  const active = getActiveEntry();
  const activeId = active.ok ? active.value.id : '';
  showModelSelection(models.value, activeId);
  selectingModel = true;
}

function handleRole(ctx: CommandContext, _args: string) {
  const roles = listRoles();
  showRoleSelection(roles, ctx.agent.getRole());
  selectingRole = true;
}

function handleRules(ctx: CommandContext, args: string) {
  if (args.startsWith('clear')) {
    const parts = args.split(/\s+/);
    const scope = parts.includes('global') ? 'global' : parts.includes('project') ? 'project' : null;
    if (scope === 'global') {
      clearGlobalRules();
      writeln(`${c.green}Global rules cleared.${c.reset}`);
    } else if (scope === 'project') {
      clearProjectRules();
      writeln(`${c.green}Project rules cleared.${c.reset}`);
    } else {
      writeln(`${c.red}Usage: /rules clear global|project${c.reset}`);
    }
  } else if (args === 'show') {
    showRulesDisplay();
  } else {
    showRulesSelection();
    selectingRules = true;
  }
}

function handleSessions(ctx: CommandContext, _args: string) {
  const sessions = SessionStore.listSessions();
  writeln();
  writeln(`${c.bold}Select a session to resume (type number, Enter to cancel):${c.reset}`);
  writeln();
  if (sessions.length === 0) {
    writeln(`  ${c.dim}(no sessions found)${c.reset}`);
    normalPrompt();
    return;
  }
  pendingSessions = sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  pendingSessions.forEach((s, i) => {
    const date = new Date(s.createdAt).toLocaleString();
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${c.bold}${s.sessionId.slice(0, 8)}${c.reset} ${c.dim}(${s.messageCount} msgs)${c.reset}`);
    writeln(`    ${c.dim}model:${c.reset} ${s.model}  ${c.dim}role:${c.reset} ${s.role}`);
    writeln(`    ${c.dim}created:${c.reset} ${date}  ${c.dim}cwd:${c.reset} ${s.cwd}`);
  });
  writeln();
  selectingSession = true;
}

function handleHelp(_ctx: CommandContext, _args: string) {
  showHelp();
}

function handleClear(ctx: CommandContext, _args: string) {
  ctx.agent.clearContext();
  const newStore = new SessionStore(process.cwd());
  const entry = getActiveEntry();
  if (entry.ok) {
    newStore.init(entry.value.model, ctx.agent.getRole(), '0.1.0');
  }
  Object.assign(ctx.sessionStore, newStore);
  ctx.onSessionReset?.();
  writeln(`${c.green}Context cleared. New session started.${c.reset}`);
}

function handleDebug(ctx: CommandContext, _args: string) {
  const entry = getActiveEntry();
  writeln(`${c.dim}Debug info:${c.reset}`);
  writeln(`  Role: ${c.bold}${ctx.agent.getRole()}${c.reset}`);
  writeln(`  Model: ${c.bold}${entry.ok ? entry.value.name : 'unknown'}${c.reset}`);
  writeln(`  CWD: ${c.dim}${process.cwd()}${c.reset}`);
  writeln(`  Session: ${c.dim}${ctx.sessionStore.getSessionId().slice(0, 8)}${c.reset}`);
  writeln(`  Messages: ${c.dim}${ctx.sessionStore.getMessageCount()}${c.reset}`);
  writeln(`  Path: ${c.dim}${ctx.sessionStore.getTranscriptPath()}${c.reset}`);
}

function handleExit(_ctx: CommandContext, _args: string) {
  writeln('bye');
  process.exit(0);
}

function showRulesDisplay() {
  const globalRules = getGlobalRules();
  const projectRules = getProjectRules();
  writeln();
  writeln(`${c.bold}${c.cyan}── Rules ──${c.reset}`);
  writeln(`\n${c.bold}Global rules${c.reset}  (${c.dim}~/.coding-agent/rules.md${c.reset})`);
  if (globalRules) writeln(globalRules);
  else writeln(`  ${c.dim}(empty)${c.reset}`);
  writeln(`\n${c.bold}Project rules${c.reset}  (${c.dim}.coderules${c.reset})`);
  if (projectRules) writeln(projectRules);
  else writeln(`  ${c.dim}(empty)${c.reset}`);
  writeln();
}
