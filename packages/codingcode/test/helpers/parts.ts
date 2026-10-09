import type { ContentPart, IncomingPart } from '../../src/llm/types.js';
import type { StoredPart } from '../../src/session/types.js';

/**
 * 测试里的纯文本内容块。
 *
 * 消息内容统一是 parts 数组，用例只关心文本时用这个helper包一层，
 * 免得每个断言点都写一遍 `[{ type: 'text', text }]`。
 */
export function text(content: string): StoredPart[] {
  return [{ type: 'text', text: content }];
}

/** 入口一侧的纯文本块（`IncomingPart[]`），程序化发起一轮输入时用。 */
export function incomingText(content: string): IncomingPart[] {
  return [{ type: 'text', text: content }];
}

/** 从 parts 里把文本拼回来，等价于生产侧的 `textOf`。 */
export function textOfParts(parts: readonly ContentPart[]): string {
  return parts.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
}
