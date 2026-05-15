import * as readline from "readline";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { Agent } from "./agent";
import { listModels, switchModel, getActiveEntry } from "./providers";
import { listRoles } from "./prompts";
import type { AgentRole } from "./prompts";
import {
  getGlobalRules,
  getProjectRules,
  clearGlobalRules,
  clearProjectRules,
  editGlobalRules,
  editProjectRules,
} from "./rules";
import { SessionStore } from "./session/store";
import type { SessionEvent } from "./session/types";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
};

let rl: readline.Interface;
let selectingModel = false;
let selectingRole = false;
let selectingRules = false;
let selectingSession = false;

function write(msg: string) {
  process.stdout.write(msg);
}

function writeln(msg = "") {
  process.stdout.write(msg + "\n");
}

function normalPrompt() {
  rl.setPrompt(`${c.blue}▸${c.reset} `);
  rl.prompt(true);
}

function showBanner() {
  const active = getActiveEntry();
  writeln(`${c.bold}${c.cyan}coding-agent${c.reset}  ${c.dim}${active.name} · /help for commands${c.reset}`);
}

function showHelp() {
  writeln(`\n${c.bold}Commands:${c.reset}
  ${c.yellow}/model${c.reset}      Pick a model interactively
  ${c.yellow}/role${c.reset}       Pick a role interactively
  ${c.yellow}/rules${c.reset}      Edit global or project rules
  ${c.yellow}/rules clear global${c.reset}   Clear global rules
  ${c.yellow}/rules clear project${c.reset}  Clear project rules
  ${c.yellow}/sessions${c.reset}   List and resume a historical session
  ${c.yellow}/clear${c.reset}      Reset conversation context and start new session
  ${c.yellow}/help${c.reset}       Show this help
  ${c.yellow}/exit${c.reset}       Quit
`);
}

function showModelSelection() {
  const models = listModels();
  const active = getActiveEntry();

  writeln();
  writeln(`${c.bold}Select a model (type number, Enter to cancel):${c.reset}`);
  writeln();
  models.forEach((m, i) => {
    const marker = m.id === active.id ? `${c.green}▶${c.reset}` : " ";
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${m.name}${c.reset}`);
    writeln(`    ${c.dim}${m.provider}/${m.model}${c.reset}`);
  });
  writeln();

  selectingModel = true;
  rl.setPrompt(`${c.yellow}▸${c.reset} `);
  rl.prompt();
}

function showRoleSelection(currentRole: AgentRole) {
  const roles = listRoles();

  writeln();
  writeln(`${c.bold}Select a role (type number, Enter to cancel):${c.reset}`);
  writeln();
  roles.forEach((r, i) => {
    const marker = r.id === currentRole ? `${c.green}▶${c.reset}` : " ";
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${r.label}${c.reset}`);
    writeln(`    ${c.dim}${r.description}${c.reset}`);
  });
  writeln();

  selectingRole = true;
  rl.setPrompt(`${c.yellow}▸${c.reset} `);
  rl.prompt();
}

function showRulesSelection() {
  writeln();
  writeln(`${c.bold}Which rules do you want to edit?${c.reset}`);
  writeln();
  writeln(` ${c.yellow}1${c.reset}. ${c.bold}Global rules${c.reset}  ${c.dim}(~/.coding-agent/rules.md)${c.reset}`);
  writeln(` ${c.yellow}2${c.reset}. ${c.bold}Project rules${c.reset}  ${c.dim}(.coderules)${c.reset}`);
  writeln(` ${c.dim}(Enter to cancel)${c.reset}`);
  writeln();

  selectingRules = true;
  rl.setPrompt(`${c.yellow}▸${c.reset} `);
  rl.prompt();
}

function showSessionSelection(agent: Agent, sessionStore: SessionStore) {
  const sessions = SessionStore.listSessions();

  writeln();
  writeln(`${c.bold}Select a session to resume (type number, Enter to cancel):${c.reset}`);
  writeln();

  if (sessions.length === 0) {
    writeln(`  ${c.dim}(no sessions found)${c.reset}`);
    normalPrompt();
    return;
  }

  const sorted = sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  sorted.forEach((s, i) => {
    const date = new Date(s.createdAt).toLocaleString();
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${c.bold}${s.sessionId.slice(0, 8)}${c.reset} ${c.dim}(${s.messageCount} msgs)${c.reset}`);
    writeln(`    ${c.dim}model:${c.reset} ${s.model}  ${c.dim}role:${c.reset} ${s.role}`);
    writeln(`    ${c.dim}created:${c.reset} ${date}  ${c.dim}cwd:${c.reset} ${s.cwd}`);
  });
  writeln();

  selectingSession = true;
  rl.setPrompt(`${c.yellow}▸${c.reset} `);
  rl.prompt();
}

function handleModelSelection(input: string) {
  const models = listModels();

  if (!input) {
    writeln(`${c.dim}Cancelled.${c.reset}`);
    selectingModel = false;
    normalPrompt();
    return;
  }

  const num = Number(input);
  if (isNaN(num) || num < 1 || num > models.length) {
    writeln(`${c.red}Type a number 1-${models.length}, or Enter to cancel${c.reset}`);
    rl.prompt();
    return;
  }

  const entry = models[num - 1]!;
  try {
    const switched = switchModel(entry.id);
    writeln(`${c.green}Switched to:${c.reset} ${c.bold}${switched.name}${c.reset}`);
  } catch (e: any) {
    writeln(`${c.red}${e.message}${c.reset}`);
  }

  selectingModel = false;
  normalPrompt();
}

function handleRoleSelection(input: string, agent: Agent) {
  const roles = listRoles();

  if (!input) {
    writeln(`${c.dim}Cancelled.${c.reset}`);
    selectingRole = false;
    normalPrompt();
    return;
  }

  const num = Number(input);
  if (isNaN(num) || num < 1 || num > roles.length) {
    writeln(`${c.red}Type a number 1-${roles.length}, or Enter to cancel${c.reset}`);
    rl.prompt();
    return;
  }

  const role = roles[num - 1]!;
  agent.switchRole(role.id);
  writeln(`${c.green}Switched role to:${c.reset} ${c.bold}${role.label}${c.reset} ${c.dim}(${role.description})${c.reset}`);

  selectingRole = false;
  normalPrompt();
}

function handleRulesSelection(input: string) {
  if (!input) {
    writeln(`${c.dim}Cancelled.${c.reset}`);
    selectingRules = false;
    normalPrompt();
    return;
  }

  const num = Number(input);
  if (isNaN(num) || num < 1 || num > 2) {
    writeln(`${c.red}Type 1 or 2, or Enter to cancel${c.reset}`);
    rl.prompt();
    return;
  }

  selectingRules = false;

  const scope = num === 1 ? "global" : "project";

  if (scope === "global") {
    writeln(`${c.dim}Opening global rules in editor...${c.reset}`);
    const ok = editGlobalRules();
    if (ok) {
      writeln(`${c.green}Global rules opened in editor.${c.reset}`);
      writeln(`${c.dim}Save & close the editor when done. Use /rules to check.${c.reset}`);
    } else {
      writeln(`${c.red}Editor failed. You can edit manually at: ~/.coding-agent/rules.md${c.reset}`);
    }
  } else {
    writeln(`${c.dim}Opening project rules in editor...${c.reset}`);
    const ok = editProjectRules();
    if (ok) {
      writeln(`${c.green}Project rules opened in editor.${c.reset}`);
      writeln(`${c.dim}Save & close the editor when done. Use /rules to check.${c.reset}`);
    } else {
      writeln(`${c.red}Editor failed. You can edit manually at: .coderules${c.reset}`);
    }
  }

  normalPrompt();
}

function handleRulesClear(args: string) {
  const parts = args.split(/\s+/);
  const scope = parts.includes("global") ? "global" : parts.includes("project") ? "project" : null;

  if (scope === "global") {
    clearGlobalRules();
    writeln(`${c.green}Global rules cleared.${c.reset}`);
  } else if (scope === "project") {
    clearProjectRules();
    writeln(`${c.green}Project rules cleared.${c.reset}`);
  } else {
    writeln(`${c.red}Usage: /rules clear global|project${c.reset}`);
  }
}

function handleSessionSelection(input: string, agent: Agent, sessionStore: SessionStore) {
  const sessions = SessionStore.listSessions();
  const sorted = sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (!input) {
    writeln(`${c.dim}Cancelled.${c.reset}`);
    selectingSession = false;
    normalPrompt();
    return;
  }

  const num = Number(input);
  if (isNaN(num) || num < 1 || num > sorted.length) {
    writeln(`${c.red}Type a number 1-${sorted.length}, or Enter to cancel${c.reset}`);
    rl.prompt();
    return;
  }

  const session = sorted[num - 1]!;
  const resumedStore = new SessionStore(process.cwd(), session.sessionId);
  const history = resumedStore.readHistory();

  if (history.length === 0) {
    writeln(`${c.red}Session not found or empty: ${session.sessionId}${c.reset}`);
    selectingSession = false;
    normalPrompt();
    return;
  }

  const { messages, role } = buildMessagesFromHistory(history);
  const newAgent = new Agent(role, resumedStore);
  newAgent.setMessages(messages);

  Object.assign(agent, newAgent);
  Object.assign(sessionStore, resumedStore);

  writeln(`${c.green}Resumed session:${c.reset} ${c.bold}${session.sessionId.slice(0, 8)}${c.reset} ${c.dim}(${messages.length} messages)${c.reset}`);

  selectingSession = false;
  normalPrompt();
}

// ── Rules helpers ──

function showRules() {
  const globalRules = getGlobalRules();
  const projectRules = getProjectRules();

  writeln();
  writeln(`${c.bold}${c.cyan}── Rules ──${c.reset}`);

  writeln(`\n${c.bold}Global rules${c.reset}  (${c.dim}~/.coding-agent/rules.md${c.reset})`);
  if (globalRules) {
    writeln(globalRules);
  } else {
    writeln(`  ${c.dim}(empty)${c.reset}`);
  }

  writeln(`\n${c.bold}Project rules${c.reset}  (${c.dim}.coderules${c.reset})`);
  if (projectRules) {
    writeln(projectRules);
  } else {
    writeln(`  ${c.dim}(empty)${c.reset}`);
  }

  const hasRules = globalRules || projectRules;
  writeln(`\n${c.dim}Rules are injected into the system prompt and MUST be followed by the model.${c.reset}`);
  writeln();
}

// ── Session helpers ──

function buildMessagesFromHistory(history: SessionEvent[]): {
  messages: ModelMessage[];
  role: AgentRole;
} {
  const messages: ModelMessage[] = [];
  let role: AgentRole = "coder";

  const pendingToolResults: Array<{
    toolName: string;
    toolCallId: string;
    output: string;
  }> = [];

  function flushToolResults() {
    if (pendingToolResults.length === 0) return;
    messages.push({
      role: "tool",
      content: pendingToolResults.map((tr) => ({
        type: "tool-result" as const,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        result: tr.output,
      })),
    } as unknown as ModelMessage);
    pendingToolResults.length = 0;
  }

  for (const event of history) {
    switch (event.type) {
      case "session_meta":
        role = event.role as AgentRole;
        break;
      case "user":
        flushToolResults();
        messages.push({ role: "user", content: event.content } as ModelMessage);
        break;
      case "assistant": {
        flushToolResults();
        if (event.toolCalls && event.toolCalls.length > 0) {
          const contentParts: any[] = [{ type: "text", text: event.content }];
          for (const tc of event.toolCalls) {
            contentParts.push({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.name,
              input: tc.arguments,
            });
          }
          messages.push({ role: "assistant", content: contentParts } as unknown as ModelMessage);
        } else {
          messages.push({ role: "assistant", content: event.content } as ModelMessage);
        }
        break;
      }
      case "tool_result":
        pendingToolResults.push({
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          output: event.output,
        });
        break;
      case "role_switch":
        role = event.toRole as AgentRole;
        break;
      case "compact_boundary":
        flushToolResults();
        messages.push({ role: "user", content: event.summary } as ModelMessage);
        break;
    }
  }

  flushToolResults();
  return { messages, role };
}

async function main() {
  let sessionStore = new SessionStore(process.cwd());
  let agent = new Agent("coder", sessionStore);

  const entry = getActiveEntry();
  sessionStore.init(entry.model, agent.getRole(), "0.1.0");

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.yellow}▸${c.reset} `,
    terminal: true,
  });

  showBanner();
  normalPrompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (selectingModel) {
      handleModelSelection(input);
      return;
    }

    if (selectingRole) {
      handleRoleSelection(input, agent);
      return;
    }

    if (selectingRules) {
      handleRulesSelection(input);
      return;
    }

    if (selectingSession) {
      handleSessionSelection(input, agent, sessionStore);
      return;
    }

    if (!input) {
      normalPrompt();
      return;
    }

    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.split(/\s+/);
      const cmdArgs = rest.join(" ").trim();

      switch (cmd) {
        case "/model":
        case "/m": {
          showModelSelection();
          break;
        }

        case "/role":
        case "/r": {
          showRoleSelection(agent.getRole());
          break;
        }

        case "/rules": {
          if (cmdArgs.startsWith("clear")) {
            handleRulesClear(cmdArgs);
          } else if (cmdArgs === "show") {
            showRules();
          } else {
            showRulesSelection();
          }
          break;
        }

        case "/sessions": {
          showSessionSelection(agent, sessionStore);
          break;
        }

        case "/help":
        case "/h": {
          showHelp();
          break;
        }

        case "/clear": {
          agent.clearContext();
          sessionStore = new SessionStore(process.cwd());
          const currentEntry = getActiveEntry();
          sessionStore.init(currentEntry.model, agent.getRole(), "0.1.0");
          agent = new Agent(agent.getRole(), sessionStore);
          writeln(`${c.green}Context cleared. New session started.${c.reset}`);
          break;
        }

        case "/debug": {
          writeln(`${c.dim}Debug info:${c.reset}`);
          writeln(`  Role: ${c.bold}${agent.getRole()}${c.reset}`);
          writeln(`  Model: ${c.bold}${getActiveEntry().name}${c.reset}`);
          writeln(`  CWD: ${c.dim}${process.cwd()}${c.reset}`);
          writeln(`  Session: ${c.dim}${sessionStore.getSessionId().slice(0, 8)}${c.reset}`);
          writeln(`  Messages: ${c.dim}${sessionStore.getMessageCount()}${c.reset}`);
          writeln(`  Path: ${c.dim}${sessionStore.getTranscriptPath()}${c.reset}`);
          break;
        }

        case "/exit":
        case "/e":
        case "/q": {
          writeln("bye");
          rl.close();
          return;
        }

        default: {
          writeln(`${c.dim}Unknown command: ${cmd}. Type /help for commands.${c.reset}`);
          break;
        }
      }

      normalPrompt();
      return;
    }

    try {
      const stream = agent.runStream(input);
      let firstChunk = true;

      let iterResult = await stream.next();
      while (!iterResult.done) {
        if (firstChunk) {
          write(`\n${c.cyan}⚡${c.reset} `);
          firstChunk = false;
        }
        write(iterResult.value);
        iterResult = await stream.next();
      }

      writeln();
      writeln();
    } catch (error: any) {
      writeln(`\n${c.red}Error: ${error.message || error}${c.reset}`);
    }

    normalPrompt();
  });

  rl.on("close", () => {
    writeln(`\n${c.dim}bye.${c.reset}`);
    writeln(`${c.dim}Session saved to: ${sessionStore.getTranscriptPath()}${c.reset}`);
    process.exit(0);
  });
}

main();
