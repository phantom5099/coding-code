import type { Message, ToolCall } from '../core/types';

export interface CompressResult {
  messages: Message[];
  didCompress: boolean;
  summary?: string;
  replacedRange?: [number, number];
  messageCount?: number;
}

export class ContextManager {
  private messages: Message[] = [];
  private readonly contextBudget: number;
  private readonly compactThreshold: number;

  constructor(contextBudget = 200_000, compactThreshold = 0.92) {
    this.contextBudget = contextBudget;
    this.compactThreshold = compactThreshold;
  }

  addUser(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistant(content: string, toolCalls?: ToolCall[]): void {
    const msg: Message = { role: 'assistant', content };
    if (toolCalls && toolCalls.length > 0) {
      (msg as any).tool_calls = toolCalls;
    }
    this.messages.push(msg);
  }

  addToolResult(toolCallId: string, output: string, toolName?: string): void {
    this.messages.push({ role: 'tool', content: output, tool_call_id: toolCallId, tool_name: toolName } as Message);
  }

  build(): Message[] {
    return [...this.messages];
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  setMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  clone(): ContextManager {
    const cm = new ContextManager(this.contextBudget, this.compactThreshold);
    cm.messages = [...this.messages];
    return cm;
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  // ── 上下文压缩 ──

  compress(): CompressResult {
    if (this.messages.length === 0) {
      return { messages: [], didCompress: false };
    }

    const threshold = this.contextBudget * this.compactThreshold;

    let currentTokens = this.estimateTokens(this.messages);
    if (currentTokens <= threshold) {
      return { messages: this.messages, didCompress: false };
    }

    // Tier 1: 截断旧工具输出
    let compressed = this.stripOldToolOutputs(this.messages);
    currentTokens = this.estimateTokens(compressed);
    if (currentTokens <= threshold) {
      this.messages = compressed;
      return { messages: compressed, didCompress: true };
    }

    // Tier 2: 摘要最旧的消息
    compressed = this.summarizeOldest(compressed);
    const replacedRange: [number, number] = [0, this.messages.length - compressed.length + 1];
    const summary = compressed.find(
      (m) => m.role === 'user' && m.content.startsWith('[Previous conversation summary]')
    )?.content ?? '';

    this.messages = compressed;
    return {
      messages: compressed,
      didCompress: true,
      summary,
      replacedRange,
      messageCount: this.messages.length - compressed.length + 1,
    };
  }

  private stripOldToolOutputs(messages: Message[]): Message[] {
    const ROUNDS_KEEP_FULL = 10;
    const assistantIndices = messages
      .map((m, i) => (m.role === 'assistant' ? i : -1))
      .filter((i) => i !== -1);
    const cutoffIndex =
      assistantIndices[Math.max(0, assistantIndices.length - ROUNDS_KEEP_FULL)] ?? 0;

    return messages.map((m, i) => {
      if (i >= cutoffIndex) return m;
      if (m.role === 'tool' && m.content.length > 200) {
        return { ...m, content: m.content.slice(0, 200) + '...[truncated]' };
      }
      return m;
    });
  }

  private summarizeOldest(messages: Message[]): Message[] {
    const KEEP_RECENT = 15;
    if (messages.length <= KEEP_RECENT) return messages;

    const oldMessages = messages.slice(0, messages.length - KEEP_RECENT);
    const recentMessages = messages.slice(messages.length - KEEP_RECENT);

    const summaryParts = oldMessages
      .filter((m) => m.role === 'assistant' && m.content.length > 10)
      .map((m) => m.content.slice(0, 100));

    const summaryText =
      `[Previous conversation summary]\n` +
      `${oldMessages.length} earlier messages summarized: ` +
      summaryParts.join('; ').slice(0, 500);

    return [
      { role: 'user', content: summaryText },
      ...recentMessages,
    ];
  }

  private estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const m of messages) {
      let charCount = 0;
      for (const char of m.content) {
        charCount += char.charCodeAt(0) > 127 ? 1.5 : 1;
      }
      total += Math.ceil(charCount / 3.5);
    }
    return total;
  }
}
