import type { Transport } from '../../transport/types';
import type { Agent } from '../../agent/agent';
import { SessionStore } from '../../session/store';
import { commands, isSelecting, handleSelectionInput } from './commands';
import { c, write, writeln, normalPrompt, showBanner } from './renderer';
import { getActiveEntry } from '../../llm/factory';

export class CliApp {
  private transport: Transport;
  private agent: Agent;
  private sessionStore: SessionStore;

  constructor(transport: Transport, agent: Agent, sessionStore: SessionStore) {
    this.transport = transport;
    this.agent = agent;
    this.sessionStore = sessionStore;
  }

  async run(): Promise<void> {
    const entry = getActiveEntry();
    showBanner(entry.ok ? entry.value.name : 'unknown');
    normalPrompt();

    while (true) {
      const req = await this.transport.recv();
      const input = req.message.trim();

      if (!input) {
        normalPrompt();
        continue;
      }

      const ctx = {
        agent: this.agent,
        sessionStore: this.sessionStore,
        onModelChange: () => this.updateSessionModel(),
        onSessionReset: () => this.updateSessionModel(),
      };

      if (isSelecting()) {
        const handled = handleSelectionInput(input, ctx);
        if (handled) continue;
      }

      if (input.startsWith('/')) {
        const [cmd, ...rest] = input.split(/\s+/);
        const args = rest.join(' ').trim();
        const handler = cmd ? commands[cmd] : undefined;
        if (handler) {
          await handler(ctx, args);
        } else {
          writeln(`${c.dim}Unknown command: ${cmd}. Type /help for commands.${c.reset}`);
        }
        normalPrompt();
        continue;
      }

      // Run agent with streaming
      try {
        const stream = this.agent.runStream(input);
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

        const result = iterResult.value as import('../../core/result').Result<string, import('../../core/error').AgentError>;
        if (!result.ok) {
          writeln(`\n${c.red}[${result.error.code}] ${result.error.message}${c.reset}`);
        }

        writeln();
        writeln();
      } catch (error: any) {
        writeln(`\n${c.red}Error: ${error.message || error}${c.reset}`);
      }

      normalPrompt();
    }
  }

  private updateSessionModel(): void {
    const entry = getActiveEntry();
    if (entry.ok) {
      this.sessionStore.init(entry.value.model, this.agent.getRole(), '0.1.0');
    }
  }
}
