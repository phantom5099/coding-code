import * as readline from "readline";
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
  ${c.yellow}/model${c.reset}            Pick a model interactively
  ${c.yellow}/role${c.reset}             Pick a role interactively
  ${c.yellow}/rules${c.reset}            Choose which rules to edit
  ${c.yellow}/rules clear global${c.reset}   Clear global rules
  ${c.yellow}/rules clear project${c.reset}  Clear project rules
  ${c.yellow}/clear${c.reset}            Reset conversation context
  ${c.yellow}/exit${c.reset}             Quit
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

// ── Rules helpers ──

/** 显示当前生效的规则 */
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

/** 处理 /rules 命令 */
function handleRulesCommand(args: string) {
  const parts = args.split(/\s+/);
  const subCmd = parts[0];

  // 检查指定的 scope（支持 "global" 和 "project"）
  const hasGlobal = parts.includes("global");
  const hasProject = parts.includes("project");
  const scope = hasGlobal ? "global" : hasProject ? "project" : null;

  switch (subCmd) {
    case "clear": {
      if (scope === "global") {
        clearGlobalRules();
        writeln(`${c.green}Global rules cleared.${c.reset}`);
      } else {
        clearProjectRules();
        writeln(`${c.green}Project rules cleared.${c.reset}`);
      }
      break;
    }

    default: {
      // 无子命令或未知子命令 → 弹出编辑选择
      showRulesSelection();
      return; // 不执行 normalPrompt，由选择处理器负责
    }
  }
}

async function main() {
  const agent = new Agent();

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

    // ── Selection mode: model ──
    if (selectingModel) {
      handleModelSelection(input);
      return;
    }

    // ── Selection mode: role ──
    if (selectingRole) {
      handleRoleSelection(input, agent);
      return;
    }

    // ── Selection mode: rules ──
    if (selectingRules) {
      handleRulesSelection(input);
      return;
    }

    if (!input) {
      normalPrompt();
      return;
    }

    // ── Commands ──
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
          handleRulesCommand(cmdArgs);
          break;
        }

        case "/help":
        case "/h": {
          showHelp();
          break;
        }

        case "/clear": {
          agent.clearContext();
          writeln(`${c.green}Context cleared.${c.reset}`);
          break;
        }

        case "/debug": {
          writeln(`${c.dim}Debug info:${c.reset}`);
          writeln(`  Role: ${c.bold}${agent.getRole()}${c.reset}`);
          writeln(`  Model: ${c.bold}${getActiveEntry().name}${c.reset}`);
          writeln(`  CWD: ${c.dim}${process.cwd()}${c.reset}`);
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

// ── Run agent ──
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
    process.exit(0);
  });
}

main();