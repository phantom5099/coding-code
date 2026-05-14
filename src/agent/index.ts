import { generateText, streamText, stepCountIs, type ToolSet } from "ai";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { getModel } from "../providers";
import { getPromptSet } from "../prompts";
import type { AgentRole } from "../prompts";
import { getAllRules } from "../rules";

export class Agent {
  private messages: ModelMessage[] = [];
  private role: AgentRole;

  constructor(role: AgentRole = "coder") {
    this.role = role;
  }

  /** 获取当前角色的提示词（含规则注入和/or环境变量注入） */
  private getSystemPrompt(): string {
    const ps = getPromptSet(this.role);
    const basePrompt = ps.buildSystem({
      cwd: process.cwd(),
      platform: process.platform,
      shell: process.env.SHELL || process.env.ComSpec || "bash",
    });

    // ── 注入全局规则和项目规则 ──
    const rules = getAllRules();
    if (rules) {
      return `${basePrompt}\n\n## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`;
    }

    return basePrompt;
  }

  /** 获取当前角色的工具集 */
  private getTools(): ToolSet {
    return getPromptSet(this.role).tools;
  }

  /** 获取当前角色的最大步数 */
  private getMaxSteps(): number {
    return getPromptSet(this.role).maxSteps ?? 15;
  }

  /** 切换角色（保留当前对话上下文） */
  switchRole(role: AgentRole): void {
    this.role = role;
  }

  /** 获取当前角色 */
  getRole(): AgentRole {
    return this.role;
  }

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: "user", content: userInput } as ModelMessage);

    const result = await generateText({
      model: await getModel(),
      system: this.getSystemPrompt(),
      messages: this.messages,
      tools: this.getTools(),
      stopWhen: stepCountIs(this.getMaxSteps()),
    });

    this.messages = [...result.response.messages];
    return result.text;
  }

  async *runStream(userInput: string): AsyncGenerator<string, string, unknown> {
    this.messages.push({ role: "user", content: userInput } as ModelMessage);

    const result = streamText({
      model: await getModel(),
      system: this.getSystemPrompt(),
      messages: this.messages,
      tools: this.getTools(),
      stopWhen: stepCountIs(this.getMaxSteps()),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield part.text;
          break;
        case "tool-call":
          yield `\n[Using: ${part.toolName}]\n`;
          break;
        case "tool-result":
          break;
        case "error":
          yield `\n[Error: ${String(part.error)}]\n`;
          break;
      }
    }

    const response = await result.response;
    this.messages = [...response.messages] as ModelMessage[];
    return "";
  }

  clearContext(): void {
    this.messages = [];
  }
}
