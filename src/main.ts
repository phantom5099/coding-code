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

// ── Output helpers ────────────────────────────────────
// Use process.stdout.write instead of console.log to avoid
// interfering with readline's prompt positioning.

let rl: readline.Interface;

function write(msg: string) {
  process.stdout.write(msg);
}

function writeln(msg = "") {
  process.stdout.write(msg + "\n");
}

function prompt() {
  rl.prompt(true); // true = preserve cursor position
}

// ── Displays ──────────────────────────────────────────

function showBanner() {
  const active = getActiveEntry();
  writeln(`${c.bold}${c.cyan}coding-agent${c.reset}  ${c.dim}${active.name} · /help for commands${c.reset}`);
}

function showModels() {
  const models = listModels();
  const active = getActiveEntry();
  writeln();
  for (const m of models) {
    const marker = m.id === active.id ? `${c.green}▶${c.reset}` : " ";
    writeln(` ${marker} ${c.bold}${m.id}${c.reset}`);
    writeln(`   ${c.dim}${m.name}  |  ${m.model}  |  ${m.base_url}${c.reset}`);
  }
  writeln();
}

function showHelp() {
  writeln(`\n${c.bold}Commands:${c.reset}
  ${c.yellow}/models${c.reset}        List all available models
  ${c.yellow}/model <id>${c.reset}     Switch to a different model (e.g. /model gpt-4o@openai)
  ${c.yellow}/clear${c.reset}          Reset conversation context
  ${c.yellow}/exit${c.reset}           Quit

${c.bold}Examples:${c.reset}
  "Read src/main.ts and explain what it does"
  "Find all TODO comments"
  "Add error handling to the utils module"
`);
}

// ── Main ──────────────────────────────────────────────

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

        case "/models":
          showModels();
          prompt();
          return;

        case "/model": {
          if (!arg) {
            writeln(`${c.red}Usage: /model <id>${c.reset} (use /models to list)`);
            prompt();
            return;
          }
          try {
            const entry = switchModel(arg);
            writeln(`${c.green}Switched to:${c.reset} ${c.bold}${entry.name}${c.reset}`);
          } catch (e: any) {
            writeln(`${c.red}${e.message}${c.reset}`);
          }
          prompt();
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
