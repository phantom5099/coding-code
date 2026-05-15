import type { ModelMessage } from "@ai-sdk/provider-utils";

/** 粗略 Token 估算器 */
export class TokenCounter {
  count(text: string): number {
    let charCount = 0;
    for (const char of text) {
      charCount += char.charCodeAt(0) > 127 ? 1.5 : 1;
    }
    return Math.ceil(charCount / 3.5);
  }

  countMessages(messages: Array<{ content?: string; role?: string }>): number {
    return messages.reduce((sum, m) => sum + this.count(m.content ?? ""), 0);
  }
}

export interface CompressResult {
  messages: ModelMessage[];
  didCompress: boolean;
  summary?: string;
  replacedRange?: [number, number];
  messageCount?: number;
}

/** 上下文压缩器 — 在传给 SDK 前预处理 messages */
export class ContextCompressor {
  private counter: TokenCounter;
  private contextBudget: number;
  private compactThreshold: number;

  constructor(
    contextBudget = 200_000,
    compactThreshold = 0.92
  ) {
    this.counter = new TokenCounter();
    this.contextBudget = contextBudget;
    this.compactThreshold = compactThreshold;
  }

  compress(
    messages: ModelMessage[],
    systemPromptTokens = 2900,
    toolDefsTokens = 3000
  ): CompressResult {
    const fixedOverhead = systemPromptTokens + toolDefsTokens;
    const availableBudget = this.contextBudget - fixedOverhead;
    const threshold = availableBudget * this.compactThreshold;

    let currentTokens = this.estimateTokens(messages);
    if (currentTokens <= threshold) {
      return { messages, didCompress: false };
    }

    // Tier 1: 截断旧工具输出
    let compressed = this.tier1StripToolOutputs(messages);
    currentTokens = this.estimateTokens(compressed);
    if (currentTokens <= threshold) {
      return { messages: compressed, didCompress: true };
    }

    // Tier 2: 摘要最旧的消息
    compressed = this.tier2SummarizeOldest(compressed, threshold);
    currentTokens = this.estimateTokens(compressed);

    const replacedRange: [number, number] = [0, messages.length - compressed.length + 1];
    const summary = compressed.find(
      (m): m is ModelMessage & { role: "user"; content: string } =>
        m.role === "user" && typeof m.content === "string" && m.content.startsWith("[Previous conversation summary]")
    )?.content ?? "";

    return {
      messages: compressed,
      didCompress: true,
      summary,
      replacedRange,
      messageCount: messages.length - compressed.length + 1,
    };
  }

  /** Tier 1: 保留最近 10 轮完整工具输出，旧的截断到 200 字符 */
  private tier1StripToolOutputs(messages: ModelMessage[]): ModelMessage[] {
    const ROUNDS_KEEP_FULL = 10;

    // 找到最近 10 个 assistant 消息的索引
    const assistantIndices = messages
      .map((m, i) => (m.role === "assistant" ? i : -1))
      .filter((i) => i !== -1);
    const cutoffIndex =
      assistantIndices[Math.max(0, assistantIndices.length - ROUNDS_KEEP_FULL)] ?? 0;

    return messages.map((m, i) => {
      if (i >= cutoffIndex) return m;

      // 对旧消息中的 tool-result 类型内容进行截断
      if ((m.role === "tool" || m.role === "user") && typeof m.content === "object" && Array.isArray(m.content)) {
        return {
          ...m,
          content: m.content.map((part: any) => {
            if (part.type === "tool-result" && typeof part.result === "string" && part.result.length > 200) {
              return { ...part, result: part.result.slice(0, 200) + "...[truncated]" };
            }
            return part;
          }),
        } as ModelMessage;
      }
      return m;
    });
  }

  /** Tier 2: 将最旧的消息块替换为摘要，保留最近 15 条 */
  private tier2SummarizeOldest(
    messages: ModelMessage[],
    maxTokens: number
  ): ModelMessage[] {
    const KEEP_RECENT = 15;
    if (messages.length <= KEEP_RECENT) return messages;

    const oldMessages = messages.slice(0, messages.length - KEEP_RECENT);
    const recentMessages = messages.slice(messages.length - KEEP_RECENT);

    // 生成简单摘要（基于 assistant 消息的内容）
    const summaryParts = oldMessages
      .filter((m): m is ModelMessage & { role: "assistant"; content: string } =>
        m.role === "assistant" && typeof m.content === "string" && m.content.length > 10
      )
      .map((m) => m.content.slice(0, 100));

    const summaryText =
      `[Previous conversation summary]\n` +
      `${oldMessages.length} earlier messages summarized: ` +
      summaryParts.join("; ").slice(0, 500);

    const summaryMessage: ModelMessage = {
      role: "user",
      content: summaryText,
    } as ModelMessage;

    return [summaryMessage, ...recentMessages];
  }

  private estimateTokens(messages: ModelMessage[]): number {
    return messages.reduce((sum, m) => {
      if (typeof m.content === "string") {
        return sum + this.counter.count(m.content);
      }
      if (Array.isArray(m.content)) {
        const textParts = m.content.map((p: any) => {
          if (p.type === "text") return p.text ?? "";
          if (p.type === "tool-result") return p.result ?? "";
          return "";
        });
        return sum + this.counter.count(textParts.join("\n"));
      }
      return sum;
    }, 0);
  }
}
