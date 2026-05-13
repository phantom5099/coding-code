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

function write(msg: string) {
  process.stdout.write(msg);
}

function writeln(msg = "") {
  process.stdout.write(msg + "\n");
}

function prompt() {
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

${c.bold}Examples:${c.reset}
  "Read src/main.ts and explain what it does"
  "Find all TODO comments"
`);
}

/**
 * Enter model selection mode — shows list, waits for user to pick a number.
 * Blocks until user selects or cancels (empty input).
 */
function enterModelSelection() {
  const models = listModels();
  const active = getActiveEntry();

  writeln();
  writeln(`${c.bold}Select a model (type number, or Enter to cancel):${c.reset}`);
  writeln();

  models.forEach((m, i) => {
    const marker = m.id === active.id ? `${c.green}▶${c.reset}` : " ";
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${m.id}${c.reset}`);
    writeln(`    ${c.dim}${m.name}  |  ${m.model}  |  ${m.base_url}${c.reset}`);
  });
  writeln();

  // Switch prompt to selection mode
  rl.setPrompt(`${c.yellow}?${c.reset} `);

  function onSelect(line: string) {
    const input = line.trim();

    // Empty → cancel
    if (!input) {
      writeln(`${c.dim}Cancelled.${c.reset}`);
      cleanup();
      prompt();
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

    cleanup();
    prompt();
  }

  function cleanup() {
    rl.removeListener("line", onSelect);
  }

  rl.on("line", onSelect);
  rl.prompt();
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
  prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      prompt();
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

        case "/model": {
          if (arg) {
            // /model <id> — direct switch
            try {
              const entry = switchModel(arg);
              writeln(`${c.green}Switched to:${c.reset} ${c.bold}${entry.name}${c.reset}`);
            } catch (e: any) {
              writeln(`${c.red}${e.message}${c.reset}`);
            }
            prompt();
          } else {
            // /model (no args) — enter selection mode
            enterModelSelection();
          }
          return;
        }

        case "/clear":
          agent.clearContext();
          writeln(`${c.dim}Context cleared.${c.reset}`);
          prompt();
          return;

        case "/help":
          showHelp();
          prompt();
          return;

        default:
          writeln(`${c.red}Unknown:${c.reset} ${cmd}. Use /help`);
          prompt();
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

    prompt();
  });

  rl.on("close", () => {
    writeln(`\n${c.dim}bye.${c.reset}`);
    process.exit(0);
  });
}

main();
