import * as readline from 'readline';
import type { Transport, UserRequest } from './types';

export class StdioTransport implements Transport {
  readonly mode = 'stdio' as const;
  private rl: readline.Interface;
  private currentResolve: ((value: UserRequest) => void) | null = null;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    this.rl.on('line', (line) => {
      if (this.currentResolve) {
        this.currentResolve({ sessionId: 'default', message: line });
        this.currentResolve = null;
      }
    });
  }

  async recv(): Promise<UserRequest> {
    return new Promise((resolve) => {
      this.currentResolve = resolve;
    });
  }

  async send(response: import('./types').AgentResponse): Promise<void> {
    console.log(response.message);
  }

  async sendStream(chunk: string): Promise<void> {
    process.stdout.write(chunk);
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}
