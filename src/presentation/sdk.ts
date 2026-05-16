import type { Agent } from '../agent/agent';
import { Result } from '../core/result';
import type { AgentError } from '../core/error';

export class CodingAgentSDK {
  constructor(private agent: Agent) {}

  async chat(message: string): Promise<Result<string, AgentError>> {
    return this.agent.run(message);
  }

  getRole(): string {
    return this.agent.getRole();
  }
}
