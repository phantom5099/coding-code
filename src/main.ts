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
  magenta: "\x1b[35m",
};

function showBanner() {
  const active = getActiveEntry();
  console.log(`${c.bold}${c.cyan}coding-agent${c.reset}  ${c.dim}${active.name} · /help for commands${c.reset}\n`);
}

function showModels() {
  const models = listModels();
  const active = getActiveEntry();
  console.log("");
  for (const m of models) {
    const marker = m.id === active.id ? `${c.green}▶${c.reset}` : " ";
    console.log(` ${marker} ${c.bold}${m.id}${c.reset}`);
    console.log(`   ${c.dim}${m.name}  |  ${m.model}  |  ${m.base_url}${c.reset}`);
  }
  console.log("");
}

function showHelp() {
  console.log(`
${c.bold}Commands:${c.reset}
  ${c.yellow}/models${c.reset}        List all available models
  ${c.yellow}/model <id>${c.reset}     Switch to a different model
  ${c.yellow}/clear${c.reset}          Reset conversation context
  ${c.yellow}/exit${c.reset}           Quit

${c.bold}Examples:${c.reset}
  "Read src/main.ts and explain what it does"
  "Find all TODO comments"
  "Add error handling to the utils module"
`);
}

async function main() {
  const agent = new Agent();

  showBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.green}▸${c.reset} `,
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ── Commands ──
    if (input.startsWith("/")) {
      const [cmd, ...args] = input.split(/\s+/);
      const arg = args.join(" ");

      switch (cmd) {
        case "/exit":
        case "/quit":
          console.log(`${c.dim}bye.${c.reset}`);
          process.exit(0);

        case "/models":
          showModels();
          rl.prompt();
          return;

        case "/model": {
          if (!arg) {
            console.log(`${c.red}Usage: /model <id>${c.reset} (use /models to list)`);
            rl.prompt();
            return;
          }
          try {
            const entry = switchModel(arg);
            console.log(`${c.green}Switched to:${c.reset} ${c.bold}${entry.name}${c.reset}\n`);
          } catch (e: any) {
            console.log(`${c.red}${e.message}${c.reset}`);
          }
          rl.prompt();
          return;
        }

        case "/clear":
          agent.clearContext();
          console.log(`${c.dim}Context cleared.${c.reset}\n`);
          rl.prompt();
          return;

        case "/help":
          showHelp();
          rl.prompt();
          return;

        default:
          console.log(`${c.red}Unknown:${c.reset} ${cmd}. Use /help`);
          rl.prompt();
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
          process.stdout.write(`\n${c.cyan}⚡${c.reset} `);
          firstChunk = false;
        }
        process.stdout.write(iterResult.value);
        iterResult = await stream.next();
      }

      process.stdout.write(`\n\n`);
    } catch (error: any) {
      console.log(`\n${c.red}Error: ${error.message || error}${c.reset}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => { console.log(`\n${c.dim}bye.${c.reset}`); process.exit(0); });
}

main();
