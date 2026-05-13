# Coding Agent 初步设计文档 — TypeScript/Bun 版

> 版本：v0.1 | 日期：2026-05-13
> 定位：终端原生 AI 编程助手，手写 ReAct Loop，零外部 Agent 框架依赖
> 运行时：Bun（推荐）或 Node.js 20+

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Coding Agent (TypeScript)                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   TUI 层      │  │  网关适配层   │  │     核心引擎          │  │
│  │   (Ink)      │  │  (预留接口)    │  │                     │  │
│  │              │  │              │  │  ┌─────────────────┐ │  │
│  │ • 对话渲染    │  │ • StdioTransport│  │ │  ReAct Loop     │ │  │
│  │ • 代码高亮    │  │ • WebSocketTr. │  │ │                 │ │  │
│  │ • 状态栏     │  │ • GatewayTr.   │  │ │ while (!done) { │ │  │
│  │ • 输入框     │  │              │  │ │   await llm()   │ │  │
│  │              │  │              │  │ │   await tool()  │ │  │
│  └──────┬───────┘  └──────┬───────┘  │ │ }               │ │  │
│         │                 │           │ └─────────────────┘ │  │
│         │                 │           │                     │  │
│         └────────┬────────┘           │  ┌─────────────────┐ │  │
│                  │                    │  │  Tool Registry  │ │  │
│                  ▼                    │  │                 │ │  │
│         ┌─────────────────┐           │  │ • readFile      │ │  │
│         │   Event Bus      │           │  │ • writeFile     │ │  │
│         │ (EventEmitter/   │           │  │ • executeCmd    │ │  │
│         │  EventTarget)    │           │  │ • gitOps        │ │  │
│         │                  │           │  │ • searchCode    │ │  │
│         │ 统一事件通道      │           │  │ • lspQuery      │ │  │
│         └─────────────────┘           │  └─────────────────┘ │  │
│                                       │                     │  │
│  ┌──────────────┐  ┌──────────────┐  │  ┌─────────────────┐ │  │
│  │   底座层      │  │  LLM 客户端   │  │ │  Subagent Pool  │ │  │
│  │              │  │              │  │ │                 │ │  │
│  │ • Sandbox    │  │ • OpenAI     │  │ │ • Worker.spawn  │ │  │
│  │   (Docker)   │  │ • Anthropic  │  │ │ • Task delegate │ │  │
│  │ • FileWatch  │  │ • DeepSeek   │  │ │ • AbortController│ │  │
│  │   (chokidar) │  │ • 通义        │  │ │ • Result stream │ │  │
│  │ • AST Parse  │  │              │  │ └─────────────────┘ │  │
│  │   (tree-sit) │  │ 统一接口      │  │                     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    基础设施层                               │   │
│  │  • Bun/Node runtime  • Zod (校验)  • pino (日志)           │   │
│  │  • commander (CLI)   • consul/env (配置)  • vitest (测试)  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、模块设计

### 2.1 模块关系图

```
                   ┌─────────────┐
                   │   src/       │
                   │   main.ts    │
                   │  (入口/CLI)   │
                   └──────┬──────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │    tui/      │ │   gateway/   │ │   engine/    │
   │   终端界面    │ │   网关适配    │ │   核心引擎    │
   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
          │               │               │
          │               │               ▼
          │               │        ┌─────────────┐
          │               │        │   react/     │
          │               │        │  ReAct Loop  │
          │               │        └──────┬──────┘
          │               │               │
          │               │        ┌──────┴──────┐
          │               │        ▼             ▼
          │               │  ┌──────────┐  ┌──────────┐
          │               │  │  tool/    │  │subagent/ │
          │               │  │ 工具注册  │  │子智能体  │
          │               │  └────┬─────┘  └────┬─────┘
          │               │       │             │
          └───────────────┼───────┼─────────────┘
                          │       │
                          ▼       ▼
                   ┌─────────────────────┐
                   │      infra/          │
                   │   LLM客户端 / 底座    │
                   │  (sandbox / fs / ast) │
                   └─────────────────────┘
```

### 2.2 目录结构

```
coding-agent/
├── package.json
├── tsconfig.json
├── bun.lockb
├── config.yaml                       # 配置文件
├── src/
│   ├── main.ts                       # CLI 入口、参数解析、初始化
│   ├── index.ts                      # 库入口，暴露核心 API
│   ├── engine/                       # 核心引擎模块
│   │   ├── index.ts                  # 模块导出
│   │   ├── react.ts                  # ReAct Loop 核心实现
│   │   ├── context.ts                # 对话上下文管理
│   │   ├── prompt.ts                 # Prompt 构建（system/user/tool）
│   │   └── session.ts                # Session 生命周期管理
│   ├── tool/                         # 工具系统
│   │   ├── index.ts                  # 模块导出
│   │   ├── registry.ts               # 工具注册表
│   │   ├── executor.ts               # 工具执行器（安全包装）
│   │   ├── fs.ts                     # 文件操作工具（读/写/列表）
│   │   ├── shell.ts                  # 命令执行工具（带沙箱限制）
│   │   ├── git.ts                    # Git 操作工具
│   │   ├── search.ts                 # 代码搜索工具（ripgrep 集成）
│   │   └── lsp.ts                    # LSP 查询工具（代码语义）
│   ├── subagent/                     # 子智能体管理
│   │   ├── index.ts                  # 模块导出
│   │   ├── pool.ts                   # Worker Pool 管理
│   │   ├── worker.ts                 # 单个 Worker 实现
│   │   └── channel.ts                # 主-子 Agent 通信通道
│   ├── llm/                          # LLM 客户端
│   │   ├── index.ts                  # 模块导出
│   │   ├── client.ts                 # 统一 LLM Client 接口
│   │   ├── openai.ts                 # OpenAI 实现
│   │   ├── anthropic.ts              # Anthropic 实现
│   │   ├── deepseek.ts               # DeepSeek 实现
│   │   └── protocol.ts               # 请求/响应协议定义
│   ├── sandbox/                      # 安全底座
│   │   ├── index.ts                  # 模块导出
│   │   ├── docker.ts                 # Docker 容器沙箱
│   │   ├── path-allowlist.ts         # 路径白名单
│   │   ├── command-filter.ts         # 命令过滤器
│   │   └── resource-limit.ts         # 资源限制（CPU/内存/时间）
│   ├── transport/                    # 网关传输层（预留）
│   │   ├── index.ts                  # 模块导出
│   │   ├── types.ts                  # 统一传输类型定义
│   │   ├── stdio.ts                  # 标准输入输出模式（本地）
│   │   ├── websocket.ts              # WebSocket 模式（远程）
│   │   └── gateway.ts                # 网关协议模式（接入统一网关）
│   ├── tui/                          # 终端界面（可选）
│   │   ├── index.ts                  # 模块导出
│   │   ├── app.tsx                   # Ink 应用主组件
│   │   ├── components/               # UI 组件
│   │   │   ├── chat.tsx              # 对话面板
│   │   │   ├── code-block.tsx        # 代码高亮块
│   │   │   ├── status-bar.tsx        # 状态栏
│   │   │   └── input-box.tsx         # 输入框
│   │   └── hooks/                    # 自定义 hooks
│   │       ├── use-agent.ts          # Agent 状态管理
│   │       └── use-stream.ts         # 流式输出管理
│   └── infra/                        # 基础设施
│       ├── index.ts                  # 模块导出
│       ├── config.ts                 # 配置管理
│       ├── error.ts                  # 全局错误类型
│       ├── logger.ts                 # 日志系统（pino）
│       ├── fs-watcher.ts             # 文件系统监控
│       └── ast-parser.ts             # AST 解析（Tree-sitter JS 绑定）
└── tests/                            # 测试
    ├── react-loop.test.ts
    ├── tool-execution.test.ts
    └── sandbox.test.ts
```

---

## 三、核心引擎设计（手写 ReAct Loop）

### 3.1 核心类型定义

```typescript
// engine/react.ts

import { EventEmitter } from "events";

/** ReAct Loop 的状态 */
export type LoopState =
  | "idle"           // 等待用户输入
  | "thinking"       // 已发送 LLM，等待响应
  | "tool_calling"   // LLM 要求调用工具
  | "tool_executing" // 工具执行中
  | "answering"      // LLM 生成最终答案
  | "error"          // 发生错误
  | "max_steps_reached"; // 达到最大步数限制

/** 单轮 Step 的结果 */
export type StepResult =
  | { type: "final_answer"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "max_steps_exceeded" }
  | { type: "llm_error"; message: string };

/** 消息角色 */
export type Role = "system" | "user" | "assistant" | "tool";

/** 消息历史中的条目 */
export interface Message {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** LLM 发起的工具调用 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/** 工具描述（传给 LLM 的格式） */
export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/** ReAct Loop 引擎配置 */
export interface ReActEngineConfig {
  maxSteps: number;
  llmTimeoutMs: number;
  toolTimeoutMs: number;
}

/** 钩子系统 — 允许在关键节点注入自定义逻辑 */
export interface HookSystem {
  beforeLLM: ((messages: Message[]) => void | Promise<void>)[];
  afterTool: ((name: string, args: string, result: ToolResult) => void | Promise<void>)[];
  onError: ((error: AgentError) => void | Promise<void>)[];
}

export type ToolResult = { ok: true; output: string } | { ok: false; error: string };

/** 错误类型 */
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }

  static llmTimeout() {
    return new AgentError("LLM_TIMEOUT", "LLM call timed out");
  }
  static llmFailed(msg: string) {
    return new AgentError("LLM_FAILED", msg);
  }
  static toolNotFound(name: string) {
    return new AgentError("TOOL_NOT_FOUND", `Tool "${name}" not found`);
  }
  static toolNotAllowed(name: string) {
    return new AgentError("TOOL_NOT_ALLOWED", `Tool "${name}" is not allowed`);
  }
  static pathNotAllowed(path: string) {
    return new AgentError("PATH_NOT_ALLOWED", `Path "${path}" is outside allowed scope`);
  }
  static maxStepsReached(max: number) {
    return new AgentError("MAX_STEPS", `Reached maximum steps (${max})`);
  }
  static subagentFailed(msg: string) {
    return new AgentError("SUBAGENT_FAILED", msg);
  }
}
```

### 3.2 ReAct Loop 核心实现

```typescript
// engine/react.ts

import { EventEmitter } from "events";
import type { LLMClient } from "../llm/client";
import type { ToolRegistry } from "../tool/registry";
import type { SubagentPool } from "../subagent/pool";
import type { Sandbox } from "../sandbox";

export interface ReActEngineDeps {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  subagentPool: SubagentPool;
  sandbox: Sandbox;
}

/**
 * ReAct Loop 引擎 — 手写实现，零框架依赖
 * 核心逻辑：
 *   1. 接收用户输入 → 加入上下文
 *   2. while (未结束 && 未超时) {
 *        a. 构造消息 → 调用 LLM（带工具描述）
 *        b. 解析响应：
 *           - 最终答案 → 返回
 *           - 工具调用 → 执行工具 → 结果加入上下文 → 继续循环
 *        c. 步数++，超过 maxSteps 报错
 *      }
 */
export class ReActEngine extends EventEmitter {
  private state: LoopState = "idle";
  private messages: Message[] = [];
  private hooks: HookSystem = { beforeLLM: [], afterTool: [], onError: [] };

  constructor(
    private deps: ReActEngineDeps,
    private config: ReActEngineConfig = { maxSteps: 25, llmTimeoutMs: 120000, toolTimeoutMs: 30000 },
  ) {
    super();
  }

  /** 主入口：运行一次对话 */
  async run(userInput: string): Promise<string> {
    // 1. 将用户输入加入上下文
    this.addMessage({ role: "user", content: userInput });
    this.emit("stateChange", "thinking");

    try {
      // 2. 运行 ReAct Loop
      const result = await this.reactLoop();

      // 3. 将最终答案加入上下文
      this.addMessage({ role: "assistant", content: result });
      this.emit("stateChange", "idle");

      return result;
    } catch (error) {
      const err = error instanceof AgentError ? error : new AgentError("UNKNOWN", String(error));
      this.emit("error", err);
      this.emit("stateChange", "error");

      // 执行 error hooks
      for (const hook of this.hooks.onError) {
        await hook(err);
      }
      throw err;
    }
  }

  /** 流式版本 — 实时产生输出 */
  async *runStream(userInput: string): AsyncGenerator<string, string, unknown> {
    this.addMessage({ role: "user", content: userInput });
    this.emit("stateChange", "thinking");

    const systemPrompt = this.buildSystemPrompt();
    const availableTools = this.deps.toolRegistry.describeAll();
    let accumulatedAnswer = "";

    for (let step = 0; step < this.config.maxSteps; step++) {
      this.emit("step", { step: step + 1, max: this.config.maxSteps });

      // --- Step 1: 构造消息列表 ---
      let messages = [...this.messages];
      if (!messages.some((m) => m.role === "system")) {
        messages.unshift({ role: "system", content: systemPrompt });
      }

      // beforeLLM hooks
      for (const hook of this.hooks.beforeLLM) {
        await hook(messages);
      }

      // --- Step 2: 调用 LLM ---
      const llmResponse = await this.callLLM(messages, availableTools);

      // --- Step 3: 解析响应 ---
      const parsed = this.parseResponse(llmResponse);

      switch (parsed.type) {
        case "final_answer": {
          this.emit("stateChange", "answering");
          accumulatedAnswer = parsed.content;
          yield parsed.content;
          this.addMessage({ role: "assistant", content: parsed.content });
          return parsed.content;
        }

        case "tool_call": {
          this.emit("stateChange", "tool_executing");
          this.emit("toolCall", { name: parsed.name, arguments: parsed.arguments });

          // 将 assistant 的 tool_call 消息加入上下文
          this.addMessage({
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: parsed.id,
                type: "function",
                function: {
                  name: parsed.name,
                  arguments: JSON.stringify(parsed.arguments),
                },
              },
            ],
          });

          // --- Step 4: 执行工具 ---
          const toolResult = await this.executeTool(parsed.name, parsed.arguments);

          // afterTool hooks
          for (const hook of this.hooks.afterTool) {
            await hook(parsed.name, JSON.stringify(parsed.arguments), toolResult);
          }

          // 将工具结果加入上下文
          const resultContent = toolResult.ok
            ? `[Tool Result]\n${toolResult.output}`
            : `[Tool Error]\n${toolResult.error}`;

          this.addMessage({
            role: "tool",
            content: resultContent,
            tool_call_id: parsed.id,
          });

          yield `[使用工具: ${parsed.name}]\n`;
          continue; // 继续下一轮循环
        }

        case "max_steps_exceeded":
          throw AgentError.maxStepsReached(this.config.maxSteps);

        case "llm_error":
          throw AgentError.llmFailed(parsed.message);
      }
    }

    throw AgentError.maxStepsReached(this.config.maxSteps);
  }

  /** 核心 ReAct Loop（非流式版本） */
  private async reactLoop(): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const availableTools = this.deps.toolRegistry.describeAll();

    for (let step = 0; step < this.config.maxSteps; step++) {
      this.emit("step", { step: step + 1, max: this.config.maxSteps });

      // Step 1: 构造消息
      let messages = [...this.messages];
      if (!messages.some((m) => m.role === "system")) {
        messages.unshift({ role: "system", content: systemPrompt });
      }

      for (const hook of this.hooks.beforeLLM) {
        await hook(messages);
      }

      // Step 2: 调用 LLM
      const llmResponse = await this.callLLM(messages, availableTools);

      // Step 3: 解析
      const parsed = this.parseResponse(llmResponse);

      switch (parsed.type) {
        case "final_answer":
          return parsed.content;

        case "tool_call": {
          this.addMessage({
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: parsed.id,
                type: "function",
                function: {
                  name: parsed.name,
                  arguments: JSON.stringify(parsed.arguments),
                },
              },
            ],
          });

          const toolResult = await this.executeTool(parsed.name, parsed.arguments);

          for (const hook of this.hooks.afterTool) {
            await hook(parsed.name, JSON.stringify(parsed.arguments), toolResult);
          }

          const resultContent = toolResult.ok
            ? `[Tool Result]\n${toolResult.output}`
            : `[Tool Error]\n${toolResult.error}`;

          this.addMessage({
            role: "tool",
            content: resultContent,
            tool_call_id: parsed.id,
          });
          continue;
        }

        case "max_steps_exceeded":
        case "llm_error":
          throw AgentError.llmFailed(parsed.message);
      }
    }

    throw AgentError.maxStepsReached(this.config.maxSteps);
  }

  /** 调用 LLM（带超时） */
  private async callLLM(
    messages: Message[],
    tools: ToolDescription[],
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.llmTimeoutMs);

    try {
      const response = await this.deps.llmClient.complete(messages, tools, controller.signal);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 解析 LLM 响应 */
  private parseResponse(response: LLMResponse): StepResult {
    // 有 tool_calls → 工具调用
    if (response.toolCalls && response.toolCalls.length > 0) {
      const tc = response.toolCalls[0];
      return {
        type: "tool_call",
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      };
    }

    // 无 tool_calls 但有内容 → 最终答案
    if (response.content) {
      return { type: "final_answer", content: response.content };
    }

    return { type: "llm_error", message: "Empty response from LLM" };
  }

  /** 执行单个工具（带沙箱包装） */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.deps.toolRegistry.get(name);
    if (!tool) {
      return { ok: false, error: `Tool "${name}" not found` };
    }

    // 沙箱校验
    if (!this.deps.sandbox.allowTool(name)) {
      return { ok: false, error: `Tool "${name}" is not allowed by sandbox policy` };
    }

    if (args.path && typeof args.path === "string") {
      if (!this.deps.sandbox.allowPath(args.path, "read")) {
        return { ok: false, error: `Path "${args.path}" is outside allowed scope` };
      }
    }

    // 执行（带超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.toolTimeoutMs);

    try {
      const output = await tool.execute(args, controller.signal);
      return { ok: true, output };
    } catch (error) {
      return { ok: false, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 构建 System Prompt */
  private buildSystemPrompt(): string {
    const toolsDesc = this.deps.toolRegistry.describeForPrompt();
    const cwd = process.cwd();
    const shell = process.env.SHELL || "bash";
    const os = process.platform;

    return `You are a coding assistant. You help users write, read, and modify code.

## Available Tools
${toolsDesc}

## Rules
1. Always use tools to read files before modifying them
2. After writing files, verify with read_file tool
3. Run tests after code changes
4. Prefer small, focused changes over large rewrites
5. Ask for clarification if requirements are ambiguous

## Environment
- Current directory: ${cwd}
- Shell: ${shell}
- Operating system: ${os}`;
  }

  /** 添加消息到上下文 */
  private addMessage(msg: Message): void {
    this.messages.push(msg);
    this.emit("message", msg);
  }

  /** 获取当前消息历史（只读） */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /** 获取当前状态 */
  getState(): LoopState {
    return this.state;
  }

  /** 注册钩子 */
  onBeforeLLM(hook: HookSystem["beforeLLM"][0]): void {
    this.hooks.beforeLLM.push(hook);
  }

  onAfterTool(hook: HookSystem["afterTool"][0]): void {
    this.hooks.afterTool.push(hook);
  }

  onError(hook: HookSystem["onError"][0]): void {
    this.hooks.onError.push(hook);
  }

  /** 清除上下文（新会话） */
  clearContext(): void {
    this.messages = [];
    this.state = "idle";
  }
}
```

### 3.3 LLM Client 统一接口

```typescript
// llm/client.ts

/** 统一的 LLM 客户端接口 */
export interface LLMClient {
  /** 调用 LLM 完成对话 */
  complete(
    messages: Message[],
    tools: ToolDescription[],
    signal?: AbortSignal,
  ): Promise<LLMResponse>;

  /** 流式调用（实时产生 token） */
  completeStream(
    messages: Message[],
    tools: ToolDescription[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, LLMResponse, unknown>;

  /** 模型信息 */
  readonly modelInfo: ModelInfo;
}

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}

// llm/openai.ts

import OpenAI from "openai";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor(
    private apiKey: string,
    private model = "gpt-4o",
    private baseURL?: string,
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async complete(
    messages: Message[],
    tools: ToolDescription[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
        })),
        tools: tools.length > 0 ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })) : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
      },
      { signal },
    );

    const choice = response.choices[0];
    return {
      content: choice.message.content || "",
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason as LLMResponse["finishReason"],
    };
  }

  async *completeStream(
    messages: Message[],
    tools: ToolDescription[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, LLMResponse, unknown> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
        })),
        tools: tools.length > 0
          ? tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        stream: true,
      },
      { signal },
    );

    let fullContent = "";
    let finalToolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        yield delta.content;
      }
      if (delta?.tool_calls) {
        // 累积 tool calls（流式可能分段返回）
        for (const tc of delta.tool_calls) {
          const existing = finalToolCalls.find((t) => t.id === tc.id);
          if (existing) {
            existing.function.arguments += tc.function?.arguments || "";
          } else if (tc.id) {
            finalToolCalls.push({
              id: tc.id,
              type: "function",
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              },
            });
          }
        }
      }
    }

    return {
      content: fullContent,
      toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      finishReason: "stop",
    };
  }

  get modelInfo(): ModelInfo {
    return {
      provider: "openai",
      model: this.model,
      maxTokens: 128000,
      supportsToolCalling: true,
      supportsStreaming: true,
    };
  }
}
```

---

## 四、工具系统设计

### 4.1 工具注册与发现

```typescript
// tool/registry.ts

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema
  readonly timeoutMs?: number;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** 注册工具 */
  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is being overwritten`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** 批量注册 */
  registerAll(tools: Tool[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /** 获取工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 获取所有工具描述（用于传给 LLM） */
  describeAll(): ToolDescription[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /** 生成 Prompt 格式的工具描述 */
  describeForPrompt(): string {
    return Array.from(this.tools.values())
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters, null, 2)}`,
      )
      .join("\n");
  }

  /** 注册所有内置工具 */
  static withDefaults(): ToolRegistry {
    const registry = new ToolRegistry();

    // 文件操作
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new ListDirTool());

    // 命令执行
    registry.register(new ExecuteCommandTool());

    // Git 操作
    registry.register(new GitStatusTool());
    registry.register(new GitDiffTool());
    registry.register(new GitCommitTool());

    // 代码搜索
    registry.register(new SearchCodeTool());

    return registry;
  }
}
```

### 4.2 文件操作工具示例

```typescript
// tool/fs.ts

import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import type { Tool } from "./registry";

export class ReadFileTool implements Tool {
  readonly name = "read_file";
  readonly description =
    "Read the contents of a file. Use this to examine code before modifying.";
  readonly parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file",
      },
      offset: {
        type: "integer",
        description: "Line number to start reading from (1-indexed)",
        default: 1,
      },
      limit: {
        type: "integer",
        description: "Maximum number of lines to read",
        default: 100,
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolve(String(args.path));

    // 安全检查：防止读取敏感路径
    if (isSensitivePath(filePath)) {
      throw new Error(`Path "${filePath}" is not allowed`);
    }

    const content = await readFile(filePath, "utf-8");

    const offset = Number(args.offset) || 1;
    const limit = Number(args.limit) || 100;

    const lines = content.split("\n");
    const start = Math.max(0, offset - 1);
    const end = Math.min(lines.length, start + limit);

    return lines.slice(start, end).join("\n");
  }
}

export class WriteFileTool implements Tool {
  readonly name = "write_file";
  readonly description =
    "Write content to a file. Creates the file if it doesn't exist.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file" },
      content: { type: "string", description: "Content to write" },
      append: {
        type: "boolean",
        description: "If true, append to file instead of overwriting",
        default: false,
      },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolve(String(args.path));

    if (isSensitivePath(filePath)) {
      throw new Error(`Path "${filePath}" is not allowed`);
    }

    const flag = args.append ? { flag: "a" as const } : {};
    await writeFile(filePath, String(args.content), flag);

    return `File written successfully: ${filePath}`;
  }
}

function isSensitivePath(path: string): boolean {
  const sensitive = [
    "/etc/passwd",
    "/etc/shadow",
    `${process.env.HOME}/.ssh`,
    `${process.env.HOME}/.gnupg`,
  ];
  return sensitive.some((s) => path.startsWith(s));
}
```

---

## 五、子智能体（Subagent）设计

### 5.1 Worker Pool 管理

```typescript
// subagent/pool.ts

import { EventEmitter } from "events";

export interface SubagentTask {
  description: string;
  instruction: string;
  contextHint?: string;
}

export interface SubagentResult {
  taskId: string;
  ok: true;
  answer: string;
  stepsTaken: number;
} | {
  taskId: string;
  ok: false;
  error: string;
};

export interface Worker {
  taskId: string;
  abortController: AbortController;
  promise: Promise<SubagentResult>;
}

export interface SubagentPoolConfig {
  maxConcurrent: number;
  defaultTimeoutMs: number;
  maxMemoryMB: number;
}

/**
 * 子智能体池 — 管理多个 Worker 的生命周期
 * 每个 Worker 是独立的 ReActEngine 实例，运行在自己的 Bun Worker 中
 */
export class SubagentPool extends EventEmitter {
  private workers = new Map<string, Worker>();

  constructor(
    private engineFactory: () => ReActEngine,
    private config: SubagentPoolConfig = {
      maxConcurrent: 5,
      defaultTimeoutMs: 120000,
      maxMemoryMB: 512,
    },
  ) {
    super();
  }

  /** 委派任务给子 Agent */
  async delegate(task: SubagentTask): Promise<SubagentResult> {
    // 检查并发限制
    if (this.workers.size >= this.config.maxConcurrent) {
      return {
        taskId: "",
        ok: false,
        error: `Max concurrent subagents (${this.config.maxConcurrent}) reached`,
      };
    }

    const taskId = `subagent-${crypto.randomUUID()}`;
    const abortController = new AbortController();

    this.emit("workerStart", { taskId, description: task.description });

    // 在 Bun Worker 中运行（真正的并行，不阻塞主线程）
    const promise = this.runInWorker(taskId, task, abortController.signal);

    const worker: Worker = { taskId, abortController, promise };
    this.workers.set(taskId, worker);

    // 超时控制
    const timeoutPromise = new Promise<SubagentResult>((_, reject) => {
      setTimeout(() => {
        abortController.abort();
        reject(new Error(`Subagent ${taskId} timed out`));
      }, this.config.defaultTimeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      this.emit("workerComplete", { taskId, result });
      return result;
    } catch (error) {
      const failedResult: SubagentResult = {
        taskId,
        ok: false,
        error: String(error),
      };
      this.emit("workerError", { taskId, error });
      return failedResult;
    } finally {
      this.workers.delete(taskId);
    }
  }

  /** 在 Worker 线程中运行子 Agent */
  private async runInWorker(
    taskId: string,
    task: SubagentTask,
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    // Bun 的 Worker 支持真正的多线程
    // 每个 Worker 拥有独立的 Engine 实例和上下文
    const worker = new Worker(new URL("./worker.ts", import.meta.url));

    return new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const result = event.data as SubagentResult;
        worker.terminate();
        resolve(result);
      };

      worker.onerror = (error) => {
        worker.terminate();
        reject(error);
      };

      signal.addEventListener("abort", () => {
        worker.terminate();
        reject(new Error("Aborted"));
      });

      // 发送任务到 Worker
      worker.postMessage({ taskId, task });
    });
  }

  /** 取消指定子 Agent */
  cancel(taskId: string): boolean {
    const worker = this.workers.get(taskId);
    if (worker) {
      worker.abortController.abort();
      this.workers.delete(taskId);
      this.emit("workerCancelled", { taskId });
      return true;
    }
    return false;
  }

  /** 取消所有子 Agent */
  cancelAll(): void {
    for (const [taskId] of this.workers) {
      this.cancel(taskId);
    }
  }

  /** 获取活跃 Worker 数量 */
  get activeCount(): number {
    return this.workers.size;
  }

  /** 获取所有 Worker 状态 */
  status(): Array<{ taskId: string; description?: string }> {
    return Array.from(this.workers.values()).map((w) => ({
      taskId: w.taskId,
    }));
  }
}
```

### 5.2 Worker 线程实现

```typescript
// subagent/worker.ts

/**
 * Worker 线程入口 — 在独立的 Bun Worker 中运行
 * 拥有完全独立的 ReActEngine 实例，崩溃不影响主 Agent
 */
self.onmessage = async (event) => {
  const { taskId, task } = event.data as { taskId: string; task: SubagentTask };

  try {
    // 创建独立的 Engine 实例（使用更严格的沙箱策略）
    const engine = createChildEngine();

    // 运行任务
    const result = await engine.run(task.instruction);

    self.postMessage({
      taskId,
      ok: true,
      answer: result,
      stepsTaken: engine.getMessages().length,
    } as SubagentResult);
  } catch (error) {
    self.postMessage({
      taskId,
      ok: false,
      error: String(error),
    } as SubagentResult);
  }
};

function createChildEngine(): ReActEngine {
  // 子 Agent 使用受限的配置
  return new ReActEngine(
    {
      llmClient: createLLMClient(), // 从环境变量创建
      toolRegistry: createRestrictedToolRegistry(), // 受限的工具集
      subagentPool: new SubagentPool(() => { throw new Error("Nested subagents not allowed"); }),
      sandbox: createStrictSandbox(),
    },
    {
      maxSteps: 15, // 子 Agent 步数更严格
      llmTimeoutMs: 60000,
      toolTimeoutMs: 15000,
    },
  );
}
```

### 5.3 在主 Agent 中暴露为工具

```typescript
// tool/delegate.ts

import type { Tool } from "./registry";
import type { SubagentPool } from "../subagent/pool";

export class DelegateTool implements Tool {
  readonly name = "delegate_to_subagent";
  readonly description = `Delegate a subtask to an independent subagent.
Use this for tasks that can be parallelized or need isolation, such as:
- Searching multiple code patterns simultaneously
- Analyzing different parts of a codebase in parallel
- Running independent verification steps`;

  readonly parameters = {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Brief description of what the subagent should do",
      },
      instruction: {
        type: "string",
        description: "Detailed instructions for the subagent",
      },
      context: {
        type: "string",
        description: "Optional context to pass to the subagent",
      },
    },
    required: ["description", "instruction"],
  };

  constructor(private pool: SubagentPool) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const result = await this.pool.delegate({
      description: String(args.description),
      instruction: String(args.instruction),
      contextHint: args.context ? String(args.context) : undefined,
    });

    if (result.ok) {
      return `Subagent completed (${result.stepsTaken} steps).\nResult:\n${result.answer}`;
    } else {
      throw new Error(`Subagent failed: ${result.error}`);
    }
  }
}
```

---

## 六、网关预留设计

### 6.1 统一传输层类型

```typescript
// transport/types.ts

/** 传输层统一接口 — 三种模式：stdio / websocket / gateway */
export interface Transport {
  /** 接收用户输入 */
  recv(): Promise<UserRequest>;

  /** 发送 Agent 响应 */
  send(response: AgentResponse): Promise<void>;

  /** 发送流式 chunk */
  sendStream(chunk: string): Promise<void>;

  /** 关闭连接 */
  close(): Promise<void>;
}

/** 用户请求（统一格式） */
export interface UserRequest {
  sessionId: string;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/** Agent 响应（统一格式） */
export interface AgentResponse {
  sessionId: string;
  message: string;
  toolCalls?: ToolCall[];
  status: ResponseStatus;
  metadata?: Record<string, unknown>;
}

export type ResponseStatus = "thinking" | "tool_calling" | "complete" | "error";

/** 网关协议消息 */
export interface GatewayMessage {
  type: "task" | "response_chunk" | "tool_call" | "heartbeat" | "cancel" | "register";
}

export interface GatewayTask extends GatewayMessage {
  type: "task";
  taskId: string;
  sessionId: string;
  userId: string;
  content: string;
  timestamp: number;
}

export interface GatewayResponseChunk extends GatewayMessage {
  type: "response_chunk";
  taskId: string;
  content: string;
  finishReason?: string;
}

export interface GatewayRegister extends GatewayMessage {
  type: "register";
  agentId: string;
  capabilities: string[];
  version: string;
}
```

### 6.2 Stdio 模式（本地终端）

```typescript
// transport/stdio.ts

import * as readline from "readline";
import type { Transport, UserRequest, AgentResponse } from "./types";

/** 标准输入输出模式 — 用户直接在终端交互 */
export class StdioTransport implements Transport {
  private rl: readline.Interface;
  private sessionId: string;

  constructor() {
    this.sessionId = crypto.randomUUID();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "> ",
    });
  }

  async recv(): Promise<UserRequest> {
    const line = await new Promise<string>((resolve) => {
      this.rl.question("", resolve);
    });

    return {
      sessionId: this.sessionId,
      message: line.trim(),
    };
  }

  async send(response: AgentResponse): Promise<void> {
    console.log(response.message);
  }

  async sendStream(chunk: string): Promise<void> {
    process.stdout.write(chunk);
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}
```

### 6.3 Gateway 模式（接入统一网关）

```typescript
// transport/gateway.ts

import type { Transport, UserRequest, AgentResponse, GatewayMessage } from "./types";

/**
 * 网关协议模式 — 接入 Go 网关（或其他网关实现）
 * Agent 作为网关的 Worker，通过 WebSocket 接收任务
 */
export class GatewayTransport implements Transport {
  private ws!: WebSocket;
  private messageQueue: UserRequest[] = [];
  private resolveNextMessage?: (req: UserRequest) => void;
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  constructor(
    private gatewayUrl: string,
    private agentId: string,
    private capabilities: string[],
  ) {}

  /** 连接到网关 */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.onopen = () => {
        // 发送注册消息
        this.sendMessage({
          type: "register",
          agentId: this.agentId,
          capabilities: this.capabilities,
          version: "0.1.0",
        });

        // 启动心跳
        this.heartbeatInterval = setInterval(() => {
          this.sendMessage({
            type: "heartbeat",
            agentId: this.agentId,
            status: "idle",
            activeTasks: 0,
          });
        }, 30000);

        resolve();
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as GatewayMessage;
        this.handleGatewayMessage(msg);
      };

      this.ws.onerror = (error) => reject(error);
      this.ws.onclose = () => {
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
        }
      };
    });
  }

  /** 处理网关消息 */
  private handleGatewayMessage(msg: GatewayMessage): void {
    switch (msg.type) {
      case "task": {
        const task = msg as { taskId: string; sessionId: string; userId: string; content: string };
        const request: UserRequest = {
          sessionId: task.sessionId,
          userId: task.userId,
          message: task.content,
          metadata: { taskId: task.taskId },
        };

        if (this.resolveNextMessage) {
          this.resolveNextMessage(request);
          this.resolveNextMessage = undefined;
        } else {
          this.messageQueue.push(request);
        }
        break;
      }

      case "cancel": {
        // 处理取消请求（通过 EventEmitter 通知上层）
        const cancel = msg as { taskId: string };
        // emit cancellation event
        break;
      }
    }
  }

  async recv(): Promise<UserRequest> {
    // 先检查队列
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    // 等待新消息
    return new Promise((resolve) => {
      this.resolveNextMessage = resolve;
    });
  }

  async send(response: AgentResponse): Promise<void> {
    const taskId = (response.metadata?.taskId as string) || "unknown";
    this.sendMessage({
      type: "response_chunk",
      taskId,
      content: response.message,
      finishReason: response.status === "complete" ? "stop" : undefined,
    });
  }

  async sendStream(chunk: string): Promise<void> {
    // 流式 chunk 实时发送
    const taskId = "current"; // 从上下文获取
    this.sendMessage({
      type: "response_chunk",
      taskId,
      content: chunk,
    });
  }

  async close(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.ws.close();
  }

  private sendMessage(msg: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
```

---

## 七、沙箱与底座设计

### 7.1 沙箱策略

```typescript
// sandbox/index.ts

export interface SandboxPolicy {
  readablePaths: string[];
  writablePaths: string[];
  allowedCommands: string[];
  blockedPaths: string[];
  commandTimeoutMs: number;
  maxReadSize: number;
  maxWriteSize: number;
}

export interface Sandbox {
  allowTool(name: string): boolean;
  allowPath(path: string, access: "read" | "write" | "execute"): boolean;
  allowCommand(cmd: string): boolean;
  childPolicy(): Sandbox;
}

export class DefaultSandbox implements Sandbox {
  private policy: SandboxPolicy;

  constructor(policy?: Partial<SandboxPolicy>) {
    this.policy = {
      readablePaths: [process.cwd()],
      writablePaths: [process.cwd()],
      allowedCommands: [
        "git", "cargo", "rustc", "python3", "node", "npm", "bun",
        "ls", "cat", "grep", "find", "echo", "mkdir", "touch",
      ],
      blockedPaths: [
        "/etc/passwd",
        "/etc/shadow",
        `${process.env.HOME}/.ssh`,
        `${process.env.HOME}/.gnupg`,
        `${process.env.HOME}/.aws`,
      ],
      commandTimeoutMs: 30000,
      maxReadSize: 10 * 1024 * 1024,  // 10MB
      maxWriteSize: 5 * 1024 * 1024,  // 5MB
      ...policy,
    };
  }

  allowTool(name: string): boolean {
    const allowedTools = [
      "read_file", "write_file", "list_dir",
      "execute_command",
      "git_status", "git_diff", "git_commit",
      "search_code",
      "delegate_to_subagent",
    ];
    return allowedTools.includes(name);
  }

  allowPath(filePath: string, access: "read" | "write" | "execute"): boolean {
    // 检查是否在禁止列表中
    if (this.policy.blockedPaths.some((b) => filePath.startsWith(b))) {
      return false;
    }

    // 检查是否在允许列表中
    const allowedList = access === "write"
      ? this.policy.writablePaths
      : this.policy.readablePaths;

    return allowedList.some((allowed) => filePath.startsWith(allowed));
  }

  allowCommand(cmd: string): boolean {
    const executable = cmd.split(" ")[0];
    return this.policy.allowedCommands.includes(executable);
  }

  /** 为子 Agent 创建更严格的策略 */
  childPolicy(): Sandbox {
    return new DefaultSandbox({
      ...this.policy,
      writablePaths: this.policy.writablePaths, // 可进一步限制
      commandTimeoutMs: 15000, // 更严格的超时
    });
  }
}
```

---

## 八、依赖清单（package.json）

```json
{
  "name": "coding-agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "dev": "bun --watch run src/main.ts",
    "build": "bun build src/main.ts --outdir ./dist --target bun",
    "build:standalone": "bun build src/main.ts --outfile ./dist/coding-agent --compile",
    "test": "bun test",
    "lint": "tsc --noEmit && biome check src/",
    "format": "biome format --write src/"
  },
  "dependencies": {
    "openai": "^4.95.0",
    "@anthropic-ai/sdk": "^0.49.0",
    "commander": "^15.0.0",
    "yaml": "^2.7.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "chokidar": "^4.0.0",
    "tree-sitter": "^0.22.0",
    "simple-git": "^3.27.0",
    "globby": "^14.1.0",
    "ignore": "^7.0.0",
    "ink": "^5.2.0",
    "react": "^18.3.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^18.3.0",
    "typescript": "^5.8.0",
    "biome": "^1.9.0",
    "vitest": "^3.0.0"
  },
  "peerDependencies": {
    "typescript": "^5.8.0"
  }
}
```

---

## 九、关键设计决策总结

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **ReAct Loop** | 手写，零框架依赖 | 逻辑简单（while 循环），框架反而增加复杂度 |
| **子 Agent 并发** | Bun Worker + AbortController | 真正多线程，崩溃隔离，支持取消 |
| **LLM 调用** | 统一接口，支持多提供商 | OpenAI/Anthropic/DeepSeek 可切换 |
| **工具系统** | 注册表 + 接口实现 | 动态注册，运行时可扩展 |
| **沙箱** | 路径白名单 + 命令过滤 + Docker（可选） | Node.js 生态下最务实的方案 |
| **网关通信** | JSON over WebSocket | 简单、通用、与 Go 网关兼容 |
| **配置** | YAML 文件 + 环境变量 | 人类可读，支持注释 |
| **错误处理** | 自定义 AgentError 类 | 带错误码，可追溯 |
| **TUI** | Ink（React for Terminal） | Claude Code 同款，feature-gated |
| **AST 解析** | Tree-sitter JS 绑定 | Coding Agent 核心能力 |
| **日志** | pino | 高性能 JSON 日志 |
| **运行时** | Bun（优先）或 Node.js 20+ | Bun 性能与 Go 同量级 |

---

## 十、与 Rust 版的核心差异

| 维度 | Rust 版 | TypeScript 版 |
|------|---------|--------------|
| **并发模型** | `tokio::spawn`（协程级） | `Bun Worker`（OS 线程级） |
| **内存安全** | 编译期保证（borrow checker） | 运行时 GC（Bun 的 JSC 引擎） |
| **沙箱能力** | **原生 Landlock/Seatbelt** | 路径白名单 + Docker |
| **二进制体积** | ~5-10 MB | ~150 MB (Bun compile) |
| **冷启动** | < 5ms | ~50-100ms |
| **开发速度** | 慢 | **快** |
| **AI 辅助写代码** | 质量较低 | **质量高（90%+ 自举）** |
| **类型系统** | 编译期强制 + 运行时零成本 | 编译期检查 + 运行时擦除 |
| **部署** | scp 一个文件即可 | `bun build --compile` 或需 Bun 运行时 |
| **长期运行** | **零内存泄漏** | 偶尔需重启（GC 碎片） |
| **IM SDK 生态** | 薄弱 | **npm 生态碾压** |
| **流式 I/O 代码** | 稍冗长（channel + goroutine） | **直观（事件循环天然匹配）** |
| **调试体验** | gdb/rust-gdb | Chrome DevTools / VS Code 内置 |
| **测试生态** | cargo test（内建） | vitest（极快，与 Bun 深度集成） |
