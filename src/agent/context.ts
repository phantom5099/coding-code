import type { Message, ToolCall } from '../core/types';

export class ContextManager {
  private messages: Message[] = [];

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
    const cm = new ContextManager();
    cm.messages = [...this.messages];
    return cm;
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
