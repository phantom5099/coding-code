import * as readline from "readline";
import { Agent } from "./agent";
import { listModels, switchModel, getActiveEntry } from "./providers";

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
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${m.id}${c.reset}`);
    writeln(`    ${c.dim}${m.name}  |  ${m.model}  |  ${m.base_url}${c.reset}`);
  });
  writeln();

  selectingModel = true;
  rl.setPrompt(`${c.yellow}?${c.reset} `);
  rl.prompt();
}

function handleModelSelection(input: string) {
  const models = listModels();

  // Empty → cancel
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

    // ── Selection mode: only accept numbers or Enter ──
    if (selectingModel) {
      handleModelSelection(input);
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
