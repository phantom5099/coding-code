import { Result } from '../core/result';
import { AgentError } from '../core/error';
import type { Message, ToolCall } from '../core/types';
import type { LLMClient } from '../llm/client';
import type { ToolExecutor } from '../tools/executor';
import type { HookRegistry } from '../core/hooks';
import { SessionStore } from '../session/store';
import { ContextCompressor } from '../context/compressor';
import type { AgentConfig, AgentDeps, LoopState } from './types';
import { ContextManager } from './context';
import { resolveConfig, mergeConfig, type ResolvedConfig } from './config';

export class Agent {
  private context: ContextManager;
  private config: ResolvedConfig;
  private sessionStore?: SessionStore;
  private compressor: ContextCompressor;
  private deps: AgentDeps;
  private state: LoopState;
  private lastAssistantUuid: string = '';

  constructor(
    deps: AgentDeps,
    config: AgentConfig,
    sessionStore?: SessionStore,
  ) {
    this.deps = deps;
    this.config = mergeConfig(resolveConfig(config.role), config);
    this.sessionStore = sessionStore;
    this.context = new ContextManager();
    this.compressor = new ContextCompressor();
    this.state = { step: 0, maxSteps: this.config.maxSteps };
  }

  /** 切换角色（保留当前对话上下文，记录 role_switch） */
  switchRole(role: string): void {
    const oldRole = this.config.role;
    this.config = mergeConfig(resolveConfig(role), {
      ...this.config,
      role,
      availableTools: resolveConfig(role).availableTools,
    });
    this.sessionStore?.recordRoleSwitch(oldRole, role);
  }

  /** 获取当前角色 */
  getRole(): string {
    return this.config.role;
  }

  /** 获取当前内存中的消息（用于恢复） */
  getMessages(): Message[] {
    return this.context.getMessages();
  }

  /** 设置内存中的消息（用于恢复） */
  setMessages(messages: Message[]): void {
    this.context.setMessages(messages);
  }

  /** 清空上下文 */
  clearContext(): void {
    this.context.clear();
    this.lastAssistantUuid = '';
  }

  /** 创建子 Agent 副本 */
  fork(configOverride: Partial<AgentConfig>): Agent {
    const child = new Agent(this.deps, { ...this.config, ...configOverride }, this.sessionStore);
    child.context = this.context.clone();
    return child;
  }

  async run(userInput: string): Promise<Result<string, AgentError>> {
    this.beforeRun(userInput);
    this.state = { step: 0, maxSteps: this.config.maxSteps };

    while (this.state.step < this.state.maxSteps) {
      this.state.step++;

      const messages = this.buildMessages();
      const tools = this.getAvailableTools();

      await this.deps.hooks.emit('llm.request.before', { messages, tools });

      const llmResult = await this.deps.llm.complete({ messages, system: this.config.systemPrompt, tools, maxSteps: 1 });

      if (!llmResult.ok) {
        await this.deps.hooks.emit('llm.response.error', { error: llmResult.error, messages });
        return llmResult;
      }

      const response = llmResult.value;
      await this.deps.hooks.emit('llm.response.after', { response, durationMs: 0 });

      // 记录 assistant 响应
      this.context.addAssistant(response.content, response.toolCalls);
      this.recordAssistant(response.content, response.toolCalls);

      // 如果没有 tool calls，结束循环
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return Result.ok(response.content);
      }

      this.state.lastToolCalls = response.toolCalls;

      // 执行工具
      for (const tc of response.toolCalls) {
        const toolResult = await this.deps.executor.execute(tc.name, tc.arguments);
        const output = toolResult.ok
          ? toolResult.value
          : `[Error: ${toolResult.error.code}] ${toolResult.error.message}`;
        this.context.addToolResult(tc.id, output, tc.name);
        this.recordToolResult(tc.name, tc.id, output);
      }
    }

    return Result.err(AgentError.maxStepsReached(this.state.maxSteps));
  }

  async *runStream(userInput: string): AsyncGenerator<string, Result<string, AgentError>, unknown> {
    this.beforeRun(userInput);
    this.state = { step: 0, maxSteps: this.config.maxSteps };

    while (this.state.step < this.state.maxSteps) {
      this.state.step++;

      const messages = this.buildMessages();
      const tools = this.getAvailableTools();

      await this.deps.hooks.emit('llm.request.before', { messages, tools });

      const { stream, response: responsePromise } = this.deps.llm.completeStream({ messages, system: this.config.systemPrompt, tools, maxSteps: 1 });

      for await (const chunk of stream) {
        yield chunk;
      }

      const llmResult = await responsePromise;

      if (!llmResult.ok) {
        await this.deps.hooks.emit('llm.response.error', { error: llmResult.error, messages });
        return llmResult as unknown as Result<string, AgentError>;
      }

      const response = llmResult.value;
      await this.deps.hooks.emit('llm.response.after', { response, durationMs: 0 });

      // 记录 assistant 响应
      this.context.addAssistant(response.content, response.toolCalls);
      this.recordAssistant(response.content, response.toolCalls);

      // 如果没有 tool calls，结束循环
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return Result.ok(response.content);
      }

      this.state.lastToolCalls = response.toolCalls;

      // 执行工具（工具执行不流式）
      for (const tc of response.toolCalls) {
        yield `\n[Using: ${tc.name}]\n`;
        const toolResult = await this.deps.executor.execute(tc.name, tc.arguments);
        const output = toolResult.ok
          ? toolResult.value
          : `[Error: ${toolResult.error.code}] ${toolResult.error.message}`;
        this.context.addToolResult(tc.id, output, tc.name);
        this.recordToolResult(tc.name, tc.id, output);
      }
    }

    return Result.err(AgentError.maxStepsReached(this.state.maxSteps));
  }

  /** 构建发送给 LLM 的消息列表 */
  private buildMessages(): Message[] {
    return this.context.build();
  }

  /** 获取当前可用的工具描述 */
  private getAvailableTools() {
    const registry = this.deps.executor.getRegistry();
    if (this.config.availableTools) {
      return registry.filter(this.config.availableTools).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.schema,
      }));
    }
    return registry.describeAll();
  }

  /** 运行前：压缩上下文 + 记录用户输入 */
  private beforeRun(userInput: string): void {
    // 1. 压缩已有消息
    const currentMessages = this.context.getMessages();
    const compressResult = this.compressor.compress(currentMessages as any);
    if (compressResult.didCompress) {
      this.context.setMessages(compressResult.messages as any);
      this.sessionStore?.recordCompactBoundary(
        compressResult.summary ?? '',
        compressResult.replacedRange ?? [0, 0],
        compressResult.messageCount ?? 0,
      );
    }

    // 2. 追加用户输入到上下文
    this.context.addUser(userInput);

    // 3. 记录到 SessionStore
    this.sessionStore?.recordUser(userInput);
  }

  /** 记录 assistant 响应到 SessionStore */
  private recordAssistant(content: string, toolCalls?: ToolCall[]): void {
    const calls = toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
    const event = this.sessionStore?.recordAssistant(content, calls, this.deps.llm.modelInfo.model);
    if (event) {
      this.lastAssistantUuid = event.uuid;
    }
  }

  /** 记录工具结果到 SessionStore */
  private recordToolResult(toolName: string, toolCallId: string, output: string): void {
    this.sessionStore?.recordToolResult(this.lastAssistantUuid, toolName, toolCallId, output);
  }
}
