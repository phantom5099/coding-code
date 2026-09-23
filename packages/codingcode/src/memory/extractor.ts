import type { LLMClient } from '../contracts/provider.js';

export async function extractMemory(opts: {
  currentMemory: string;
  transcript: string;
  llm: LLMClient;
}): Promise<string | null> {
  const { currentMemory, transcript, llm } = opts;

  const systemPrompt = `你是记忆整理器。基于"已有记忆"和"会话记录"，输出整份最新版长期记忆，放在 <memory>...</memory> 块中，不要输出其它内容。

规则：
- 只保留值得跨会话记住的信息：用户角色、偏好与对 Agent 的纠正，项目架构决策、技术选型与部署信息，外部资源与链接等。
- 忽略临时内容：一次性任务、调试过程、报错堆栈、闲聊。
- 更新哪些内容由你决定：在已有记忆基础上自行增、删、改，输出必须是一份完整、自洽的最新记忆，而不是只输出变动部分。
- 旧记忆与对话新信息矛盾时以最新为准；同一会话前后不一致时以最后出现为准。
- 不要编造对话中未出现的信息。
- 若没有值得记住的新信息且已有记忆为空，输出 <memory></memory>。

格式：
- 纯 Markdown，用 "### 主题" 小节组织，小节下用 "- " 列要点。
- 条目需具体、自包含，避免"上面提到的那个"这类指代。
- <memory> 内不要带任何解释性文字。`;

  const userMessage = `已有记忆：
${currentMemory || '（空）'}

会话记录（按 [user]/[assistant]/[tool:名称] 标注）：
${transcript || '（空）'}`;

  try {
    const stream = llm.completeStream({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    let fullOutput = '';
    for await (const part of stream) {
      if (part.type === 'text') fullOutput += part.text;
    }

    const memoryMatch = fullOutput.match(/<memory>([\s\S]*?)<\/memory>/);

    if (!memoryMatch) {
      return null;
    }

    const extracted = memoryMatch[1]!.trim();
    return extracted || null;
  } catch {
    return null;
  }
}
