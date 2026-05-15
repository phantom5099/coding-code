export const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

export function write(msg: string): void {
  process.stdout.write(msg);
}

export function writeln(msg = ''): void {
  process.stdout.write(msg + '\n');
}

export function normalPrompt(): void {
  write(`${c.blue}▸${c.reset} `);
}

export function showBanner(modelName: string): void {
  writeln(`${c.bold}${c.cyan}coding-agent${c.reset}  ${c.dim}${modelName} · /help for commands${c.reset}`);
}

export function showHelp(): void {
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

export function showModelSelection(models: Array<{ id: string; name: string; provider: string; model: string }>, activeId: string): void {
  writeln();
  writeln(`${c.bold}Select a model (type number, Enter to cancel):${c.reset}`);
  writeln();
  models.forEach((m, i) => {
    const marker = m.id === activeId ? `${c.green}▶${c.reset}` : ' ';
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${m.name}${c.reset}`);
    writeln(`    ${c.dim}${m.provider}/${m.model}${c.reset}`);
  });
  writeln();
}

export function showRoleSelection(roles: Array<{ id: string; label: string; description: string }>, currentRole: string): void {
  writeln();
  writeln(`${c.bold}Select a role (type number, Enter to cancel):${c.reset}`);
  writeln();
  roles.forEach((r, i) => {
    const marker = r.id === currentRole ? `${c.green}▶${c.reset}` : ' ';
    writeln(` ${c.yellow}${i + 1}${c.reset}. ${marker} ${c.bold}${r.label}${c.reset}`);
    writeln(`    ${c.dim}${r.description}${c.reset}`);
  });
  writeln();
}

export function showRulesSelection(): void {
  writeln();
  writeln(`${c.bold}Which rules do you want to edit?${c.reset}`);
  writeln();
  writeln(` ${c.yellow}1${c.reset}. ${c.bold}Global rules${c.reset}  ${c.dim}(~/.coding-agent/rules.md)${c.reset}`);
  writeln(` ${c.yellow}2${c.reset}. ${c.bold}Project rules${c.reset}  ${c.dim}(.coderules)${c.reset}`);
  writeln(` ${c.dim}(Enter to cancel)${c.reset}`);
  writeln();
}
