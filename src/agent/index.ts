import { generateText, streamText, stepCountIs, type ToolSet } from "ai";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { getModel, getActiveEntry } from "../providers";
import { getPromptSet } from "../prompts";
import type { AgentRole } from "../prompts";
import { getAllRules } from "../rules";
import { SessionStore } from "../session/store";
import { ContextCompressor } from "../context/compressor";

export class Agent {
  private messages: ModelMessage[] = [];
  private role: AgentRole;
  private sessionStore?: SessionStore;
  private compressor: ContextCompressor;

  constructor(role: AgentRole = "coder", sessionStore?: SessionStore) {
    this.role = role;
    this.sessionStore = sessionStore;
    this.compressor = new ContextCompressor();
  }

  /** 获取当前角色的提示词（含规则注入） */
  private getSystemPrompt(): string {
    const ps = getPromptSet(this.role);
    const basePrompt = ps.buildSystem({
      cwd: process.cwd(),
      platform: process.platform,
      shell: process.env.SHELL || process.env.ComSpec || "bash",
    });

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

  /** 切换角色（保留当前对话上下文，记录 role_switch） */
  switchRole(role: AgentRole): void {
    this.sessionStore?.recordRoleSwitch(this.role, role);
    this.role = role;
  }

  /** 获取当前角色 */
  getRole(): AgentRole {
    return this.role;
  }

  /** 获取当前内存中的消息（用于恢复） */
  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  /** 设置内存中的消息（用于恢复） */
  setMessages(messages: ModelMessage[]): void {
    this.messages = [...messages];
  }

  /** 清空上下文 */
  clearContext(): void {
    this.messages = [];
  }

  async run(userInput: string): Promise<string> {
    const modelId = this.beforeRun(userInput);
    const beforeCount = this.messages.length;

    const result = await generateText({
      model: await getModel(),
      system: this.getSystemPrompt(),
      messages: this.messages,
      tools: this.getTools(),
      stopWhen: stepCountIs(this.getMaxSteps()),
    });

    this.afterRun(result.response.messages as ModelMessage[], modelId, beforeCount);
    return result.text;
  }

  async *runStream(userInput: string): AsyncGenerator<string, string, unknown> {
    const modelId = this.beforeRun(userInput);
    const beforeCount = this.messages.length;

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
    this.afterRun(response.messages as ModelMessage[], modelId, beforeCount);
    return "";
  }

  /** 运行前：压缩上下文 + 记录用户输入 */
  private beforeRun(userInput: string): string {
    // 1. 压缩已有消息
    const compressResult = this.compressor.compress(this.messages);
    if (compressResult.didCompress && this.sessionStore) {
      this.messages = compressResult.messages;
      this.sessionStore.recordCompactBoundary(
        compressResult.summary ?? "",
        compressResult.replacedRange ?? [0, 0],
        compressResult.messageCount ?? 0
      );
    }

    // 2. 追加用户输入到内存
    this.messages.push({ role: "user", content: userInput } as ModelMessage);

    // 3. 记录到 SessionStore
    this.sessionStore?.recordUser(userInput);

    // 4. 获取实际模型标识
    const entry = getActiveEntry();
    return entry.model;
  }

  /** 运行后：解析新增消息并记录到 SessionStore */
  private afterRun(
    responseMessages: ModelMessage[],
    modelId: string,
    beforeCount: number
  ): void {
    // SDK 返回的 messages 包含完整历史，新增部分从 beforeCount 开始
    const newMessages = responseMessages.slice(beforeCount);
    let lastAssistantUuid: string | undefined;

    for (const msg of newMessages) {
      if (msg.role === "assistant") {
        const { content, toolCalls } = this.parseAssistantMessage(msg);
        const event = this.sessionStore?.recordAssistant(content, toolCalls, modelId);
        if (event) lastAssistantUuid = event.uuid;
      } else if (msg.role === "user") {
        const toolResults = this.parseToolResults(msg);
        for (const tr of toolResults) {
          this.sessionStore?.recordToolResult(
            lastAssistantUuid ?? "unknown",
            tr.toolName,
            tr.toolCallId,
            tr.output
          );
        }
      }
    }

    this.messages = [...responseMessages];
  }

  /** 从 assistant ModelMessage 中提取 content 和 toolCalls */
  private parseAssistantMessage(msg: ModelMessage): {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  } {
    let content = "";
    const toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }> = [];

    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          content += part.text;
        } else if (part.type === "tool-call") {
          toolCalls.push({
            id: (part as any).toolCallId ?? (part as any).toolCallID ?? "unknown",
            name: (part as any).toolName ?? "unknown",
            arguments: ((part as any).args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /** 从 user ModelMessage 中提取 tool results */
  private parseToolResults(
    msg: ModelMessage
  ): Array<{ toolName: string; toolCallId: string; output: string }> {
    const results: Array<{ toolName: string; toolCallId: string; output: string }> = [];

    if (typeof msg.content === "string") {
      // 纯文本 user 消息，不是 tool result
      return results;
    }

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const rawResult = (part as any).result;
          results.push({
            toolName: (part as any).toolName ?? "unknown",
            toolCallId: (part as any).toolCallId ?? (part as any).toolCallID ?? "unknown",
            output: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult),
          });
        }
      }
    }

    return results;
  }
}
