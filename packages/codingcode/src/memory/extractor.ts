import type { LLMClient } from '../llm/client.js';
import type { MemoryTypeConfig } from '@codingcode/infra/config';
import type { StructuredTranscript } from './types.js';

export async function extractMemory(opts: {
  currentAuto: string;
  transcript: StructuredTranscript;
  types: MemoryTypeConfig[];
  llm: LLMClient;
}): Promise<string | null> {
  const { currentAuto, transcript, types, llm } = opts;

  const typeDescriptions = types.map((t) => `- **${t.name}**: ${t.description}`).join('\n');

  const typeGuidelineMap: Record<string, string> = {
    user: '- **user**: 从 [user] 标签提取用户角色、技能栈、对 Agent 的工作偏好及纠正',
    project: '- **project**: 从 [user] 和 [assistant] 标签提取架构决策、技术选型、部署信息',
    reference: '- **reference**: 从 [user] 和 [tool:*] 标签提取外部资源、文档、Dashboard 链接',
  };

  const typeGuidance = types
    .map((t) => typeGuidelineMap[t.name])
    .filter(Boolean)
    .join('\n');

  const formatExamples = types
    .map((t) => {
      switch (t.name) {
        case 'user':
          return '### user\n- 要点一\n- 要点二';
        case 'project':
          return '### project\n- 架构决策';
        case 'reference':
          return '### reference\n- [标题](URL)';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = `你是记忆提取器。从对话记录中提取值得长期记忆的内容，输出 <memory>...</memory> 块。
如果没有值得记忆的内容，输出 <memory></memory>。

规则：
- 新信息与已有记忆矛盾时，用新信息替换旧条目
- 同一会话内前后不一致，以最新出现的为准
- 只输出有内容的 ### 小节，忽略临时调试、一次性任务、报错堆栈

记忆类型及信息来源：
${typeGuidance}

格式：
${formatExamples}`;

  const userMessage = `已有记忆：
${currentAuto}

会话记录：
[user] ${transcript.userOnly}
---
[user+assistant] ${transcript.userAndAssistant}
---
[user+tool] ${transcript.userAndTools}`;

  try {
    const result = llm.completeStream({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    let output = '';
    for await (const chunk of result.stream) {
      output += chunk;
    }

    const response = await result.response;
    if (!response.ok) {
      return null;
    }

    const fullOutput = response.value.content || output;
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
