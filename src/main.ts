import * as readline from "readline";
import { Agent } from "./agent";
import { listModels, switchModel, getActiveEntry } from "./providers";
import { listRoles, switchRole } from "./prompts";
import type { AgentRole } from "./prompts";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

let rl: readline.Interface;
let selectingModel = false;
let selectingRole = false;

function write(msg: string) {
  process.stdout.write(msg);
}

function writeln(msg = "") {
  process.stdout.write(msg + "\n");
}

function normalPrompt() {
  rl.setPrompt(`${c.green}▸${c.reset} `);
  rl.prompt(true);
}

function showBanner() {
  const active = getActiveEntry();
  writeln(`${c.bold}${c.cyan}coding-agent${c.reset}  ${c.dim}${active.name} · /help for commands${c.reset}`);
}

function showHelp() {
  writeln(`\n${c.bold}Commands:${c.reset}
  ${c.yellow}/model${c.reset}         Pick a model interactively
  ${c.yellow}/model <id>${c.reset}    Switch directly by id
  ${c.yellow}/role${c.reset}          Pick a role interactively
  ${c.yellow}/role <id>${c.reset}     Switch directly by role id
  ${c.yellow}/clear${c.reset}         Reset conversation context
  ${c.yellow}/exit${c.reset}          Quit
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
  rl.setPrompt(`${c.yellow}?${c.reset} `);
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
  rl.setPrompt(`${c.yellow}?${c.reset} `);
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

async function main() {
  const agent = new Agent();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.green}▸${c.reset} `,
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

    if (!input) {
      normalPrompt();
      return;
    }

    // ── Commands ──
    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.split(/\s+/);
      const arg = rest.join(" ");

      switch (cmd!) {
        case "/exit":
        case "/quit":
          writeln(`${c.dim}bye.${c.reset}`);
          process.exit(0);

        case "/models":
        case "/model": {
          if (arg) {
            try {
              const entry = switchModel(arg);
              writeln(`${c.green}Switched to:${c.reset} ${c.bold}${entry.name}${c.reset}`);
            } catch (e: any) {
              writeln(`${c.red}${e.message}${c.reset}`);
            }
            normalPrompt();
          } else {
            showModelSelection();
          }
          return;
        }

        case "/roles":
        case "/role": {
          if (arg) {
            try {
              const ps = switchRole(arg);
              agent.switchRole(ps.label.toLowerCase() as AgentRole);
              writeln(`${c.green}Switched to role:${c.reset} ${c.bold}${ps.label}${c.reset}`);
            } catch (e: any) {
              writeln(`${c.red}${e.message}${c.reset}`);
            }
            normalPrompt();
          } else {
            showRoleSelection(agent.getRole());
          }
          return;
        }

        case "/clear":
          agent.clearContext();
          writeln(`${c.dim}Context cleared.${c.reset}`);
          normalPrompt();
          return;

        case "/help":
          showHelp();
          normalPrompt();
          return;

        default:
          writeln(`${c.red}Unknown:${c.reset} ${cmd}. Use /help`);
          normalPrompt();
          return;
      }
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
