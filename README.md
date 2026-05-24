# Coding Code

> 手写 ReAct Loop · 零框架依赖 · 多端统一 · 深度可配置

**Coding Code** 是一个终端原生的 AI 编程助手。核心引擎纯手写 ReAct 循环，通过 HTTP 服务化对外暴露，TUI / Web 等所有端共享同一份编排逻辑。用户可以自由配置子智能体、工具、提示词、钩子、模型和工作流——没有黑盒，所有行为都可定制。

## 三层设计

| 层 | 包 | 职责 |
|---|---|---|
| 客户端 | `@codingcode/tui` | Ink/React 终端渲染，纯 UI 层 |
| 核心 | `@codingcode/core` | ReAct 引擎、工具系统、MCP 集成、上下文管理、长期记忆、会话持久化、HTTP 服务 |
| 基础设施 | `@codingcode/infra` | 配置加载、日志、共享类型 |

## 设计原则

- **Agent 是纯 ReAct 循环** — 不持有 Session、不调 Bus、不感知传输协议。Agent 只做一件事：while 循环调用 LLM + 执行工具。
- **编排逻辑写死在一处** — `orchestration/bootstrap.ts` 是唯一的跨域编排入口，TUI、HTTP API、SDK 都走同一份代码。
- **所有端共享 HTTP API** — Agent 作为独立 HTTP 服务运行，任何能发 HTTP 请求的客户端都可以接入。
- **Effect TS 托管依赖** — 编译期强制处理错误，Layer 声明式装配，测试时可替换任意服务。

---

## 快速开始

```bash
# 安装依赖
npm install

# 配置 API Key（以 DeepSeek 为例）
export DEEPSEEK_API_KEY=sk-xxx

# 启动（server + TUI）
npm start

# 仅启动 server（供 Web / SDK 调用）
npm start serve

# 仅启动 TUI（连接已有 server）
npm start tui
```

首次启动后，默认以 **Coder** 角色运行，使用 `models.json` 中标记为 `active` 的模型。

### 目录结构

```
coding-agent/
├── packages/
│   ├── codingcode/src/           # @codingcode/core — 核心引擎
│   │   ├── agent/                #   ReAct Loop（纯引擎，无副作用）
│   │   ├── llm/                  #   LLM 客户端工厂（多厂商）
│   │   ├── mcp/                  #   MCP 服务集成
│   │   ├── context/              #   上下文管理 + 自动压缩
│   │   ├── session/              #   JSONL 会话持久化
│   │   ├── memory/               #   长期记忆（用户/项目级）
│   │   ├── checkpoint/           #   变更跟踪 + Git Shadow
│   │   ├── tools/                #   工具注册表 + 执行器
│   │   │   └── domains/          #     按域分类的工具实现
│   │   ├── approval/             #   执行前审批流水线
│   │   ├── hooks/                #   可插拔钩子系统
│   │   ├── prompts/              #   系统提示词构建
│   │   ├── rules/                #   规则注入
│   │   ├── sandbox/              #   OS 级沙箱集成
│   │   ├── server/               #   Hono HTTP 服务 + SSE
│   │   ├── orchestration/        #   跨域编排入口
│   │   ├── agent-state/          #   代理状态管理
│   │   ├── subagent/             #   子智能体加载和注册
│   │   ├── skills/               #   技能系统
│   │   └── cli.ts                #   CLI 入口
│   ├── tui/src/                  # @codingcode/tui — Ink 终端 UI
│   │   ├── components/           #   App, InputBox, MessageItem 等
│   │   └── hooks/                #   useAgentRunner, useTerminalSize
│   └── infra/src/                # @codingcode/infra — 基础设施
├── models.json                   # 模型/厂商目录
└── package.json                  # npm workspaces monorepo
```

---

## 配置

Coding Code 的核心哲学是**所有行为都可配置**。用户通过以下配置控制 Agent：

| 配置文件 | 作用 |
|---|---|
| `models.json` | 模型厂商、模型列表、API 地址 |
| `codingcode.yaml` | 应用级配置（并发数、超时、token 预算等） |
| `~/.codingcode/rules.md` + `./AGENTS.md` | 全局 + 项目级规则，注入 system prompt |
| `mcp.json` (可选) | MCP 服务配置 |
| `~/.codingcode/memory.yaml` (可选) | 长期记忆配置 |

### 模型配置 (`models.json`)

```json
{
  "active": "deepseek",
  "providers": [
    {
      "name": "deepseek",
      "driver": "deepseek",
      "base_url": "https://api.deepseek.com",
      "api_key_env": "DEEPSEEK_API_KEY",
      "default_model": "deepseek-v4-flash",
      "models": [
        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
        { "id": "deepseek-chat", "name": "DeepSeek V3" }
      ]
    }
  ]
}
```

- `driver`: `"deepseek"` 使用原生 SDK，`"openai"` 使用 OpenAI 兼容 API
- `active`: 指定默认使用的厂商
- `api_key_env`: 从环境变量读取 API Key
- 运行时可通过 `/model` 命令或 API 切换模型

### 规则配置

```
~/.codingcode/rules.md        # 全局规则，所有项目生效
./AGENTS.md                   # 项目级规则，自动注入 system prompt
```

规则以 Markdown 编写，在每次 LLM 调用时自动注入到 system prompt 中。可以在这里定义编码规范、项目约定、安全策略等。

---

## 工具系统

### 内置工具

#### 文件操作 (fs)
| 工具 | 功能 |
|---|---|
| `read_file` | 读取文件，支持 offset/limit 行号控制 |
| `write_file` | 写入/创建文件 |
| `edit_file` | 编辑文件中的特定代码段 |
| `glob_files` | 模式匹配查找文件 |
| `search_code` | 正则搜索项目代码 |

#### 命令执行
| 工具 | 功能 |
|---|---|
| `execute_command` | 执行 shell 命令（带沙箱过滤和超时） |

#### 网络
| 工具 | 功能 |
|---|---|
| `fetch_url` | HTTP GET 请求（带超时） |
| `search_web` | Web 搜索（需配置） |

#### 代理状态
| 工具 | 功能 |
|---|---|
| `read_todo` | 读取代理的任务列表 |
| `write_todo` | 修改代理的任务列表 |
| `tool_search` | 发现和加载可用工具 |

#### 子智能体
| 工具 | 功能 |
|---|---|
| `delegate_to_subagent` | 将任务委派给子智能体 |

### 工具加载机制

- **Core 工具**：始终可用，在启动时注册
- **Deferred 工具**：按需加载，通过 `tool_search` 发现后动态加载
- **MCP 工具**：从 MCP 服务自动导入和注册

### 自定义工具

工具通过 `ToolService` 注册，每个工具实现 `ToolDefinition` 接口：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema | Record<string, unknown>;
  jsonSchema?: Record<string, unknown>;
  deferred?: boolean;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}
```

在 `cli.ts` 中向 `ToolService` 注册新工具，Agent 会自动将其暴露给 LLM。

### 沙箱隔离

所有工具执行经过两层安全保护：

**审批流水线**（始终生效）：六层决策链——规则引擎（硬 deny）→ 只读白名单 → 权限模式 → 钩子策略 → 用户确认 → 审计日志。开箱即用，无需额外安装。

**OS 级沙箱**（可选）：需要安装 `@anthropic-ai/sandbox-runtime`，提供文件系统隔离、网络隔离、防绕过等能力。

---

## 长期记忆系统 (Memory)

Coding Code 支持多会话的长期记忆，自动从对话中提取和存储关键信息：

### 内存类型

| 类型 | 位置 | 作用 |
|---|---|---|
| **用户级** | `~/.codingcode/memory/` | 跨所有项目的个人知识库 |
| **项目级** | `./.codingcode/memory/` | 特定项目的上下文 |

### 记忆内容

- **user**: 用户角色、技能、偏好
- **feedback**: 工作流程中的教训和已验证的方法
- **project**: 当前项目的目标、deadline、决策
- **reference**: 外部资源和文档链接

### 自动提取

Agent 在每次会话后自动：
1. 从对话中识别值得保存的信息
2. 按类型分类和结构化
3. 存储到对应的内存文件
4. 在下次启动时自动加载到 system prompt

### 手动编辑

记忆文件采用 Markdown 格式，支持手动编辑：

```markdown
---
name: feature-name
description: one-line summary
metadata:
  type: user/feedback/project/reference
---

Memory content here...
```

---

## MCP 集成 (Model Context Protocol)

Coding Code 集成 MCP 协议，允许通过外部服务扩展工具：

### 配置 MCP 服务

在项目根目录创建 `mcp.json`：

```json
{
  "mcpServers": [
    {
      "name": "custom-tools",
      "command": "node",
      "args": ["./server.js"],
      "type": "stdio"
    }
  ]
}
```

### 自动集成

启动时，Coding Code 会：
1. 连接所有配置的 MCP 服务
2. 列出各服务提供的工具
3. 自动注册为 Tool Definition
4. Agent 可直接调用，无需额外配置

### MCP 工具白名单

在角色配置中指定工具白名单时，MCP 工具遵循同样规则。

---

## Checkpoint 系统

Coding Code 记录所有文件变更，支持查看历史和回滚：

### 功能

- **Shadow Git**: 独立的变更日志，不依赖用户的 .git
- **Ledger**: 按会话记录每个文件操作
- **Diff 视图**: 查看特定会话前后的文件差异
- **回滚**: 恢复到任意检查点

### 使用

```bash
# 查看变更历史
GET /api/sessions/:id/checkpoint

# 恢复到特定检查点
POST /api/sessions/:id/checkpoint/restore
```

---

## 钩子系统 (Hooks)

8 个可插拔钩子点，用户可以在关键节点注入自定义逻辑：

| 钩子点 | 触发时机 |
|---|---|
| `tool.execute.before` | 工具执行前 |
| `tool.execute.after` | 工具执行成功后 |
| `tool.execute.error` | 工具执行失败后 |
| `llm.request.before` | LLM 调用前 |
| `llm.response.after` | LLM 响应成功后 |
| `llm.response.error` | LLM 调用失败后 |
| `session.save.before` | 会话保存前 |
| `session.save.after` | 会话保存后 |

```typescript
hookRegistry.on('llm.request.before', async (messages) => {
  const estimatedTokens = JSON.stringify(messages).length / 4;
  console.log(`[Hook] 即将调用 LLM，预估 ${Math.round(estimatedTokens)} tokens`);
});
```

---

## 子智能体系统 (Subagent)

每个子 Agent 是独立的 ReAct 引擎实例，拥有受限的工具集和独立的上下文：

### 特性

- **独立执行**: 子 Agent 在独立的 Effect Context 中运行
- **受限工具集**: 每个子 Agent 模板定义自己的工具白名单
- **独立上下文**: 不共享主 Agent 的消息历史
- **自由定义**: 用户可配置任意数量的子 Agent 模板

### 子 Agent 模板

在 `subagents.json` 中定义（或在代码中注册）：

```typescript
{
  name: "code-searcher",
  description: "专门搜索代码库的子 Agent",
  tools: ["search_code", "read_file"],
  systemPrompt: "You are a code search specialist...",
  maxSteps: 10,
  timeoutMs: 60000
}
```

### 使用

主 Agent 通过 `delegate_to_subagent` 工具委派任务：

```typescript
// Agent 调用
await agent.executeTool('delegate_to_subagent', {
  subagent: 'code-searcher',
  task: 'Find all usages of getUserById function'
});
```

---

## 工作流

完整的工作流如下：

```
用户输入 
  ↓
System Prompt（角色 + 规则 + 记忆）
  ↓
LLM 调用（可切换模型）
  ↓
ReAct Loop（步数可配置）
  ├── Tool Call
  ├── Approval Pipeline（审批）
  ├── Tool Execution（沙箱执行）
  ├── Hook Points（钩子注入）
  ├── Subagent Delegation（可选，并行）
  └── Context Compression（自动触发，90% token 预算）
  ↓
响应流（SSE 实时推送）
  ↓
会话持久化（JSONL）
  ↓
Checkpoint 记录（文件变更）
  ↓
Memory 提取（自动保存）
```

每个环节都可配置，没有黑盒的"工作流引擎"。

---

## 多端接入

Coding Code 的 Agent 是一个**独立的 HTTP 服务**，所有端平等接入：

```
                    ┌─────────────────┐
                    │  Hono HTTP Server │
                    │  /api/sessions    │
                    │  /api/messages    │← SSE 流式响应
                    │  /api/models      │
                    │  /api/roles       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   ┌─────────┐         ┌─────────┐          ┌─────────┐
   │   TUI   │         │   Web   │          │  SDK    │
   │  (Ink)  │         │ (React) │          │ (Node)  │
   └─────────┘         └─────────┘          └─────────┘
```

### TUI (`@codingcode/tui`)

- 基于 **Ink v7** (React for terminal)
- 键盘快捷键: 消息聚焦 (↑↓)、展开详情 (Ctrl+O)、面板切换 (/model, /role, /sessions, /help)
- 通过 HTTP 客户端连接 server，不持有 Agent 引用

### SDK

```typescript
import { CodingCodeClient } from '@codingcode/core';

const client = new CodingCodeClient('http://localhost:3000');
const session = await client.createSession();

for await (const chunk of client.sendMessage(session.id, '帮我写一个快排')) {
  process.stdout.write(chunk);
}
```

---

## 上下文管理与压缩

上下文管理是独立域，不耦合在 Agent 内部：

- **自动压缩**: 当上下文超过 token 预算的 90%（默认 200K），自动触发压缩
- **两种策略**: 
  1. 截断旧工具输出 
  2. 总结最早的消息
- **显式压缩**: 可通过 `POST /api/sessions/:id/compact` 手动触发

---

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript 5.8 |
| 运行时 | Node.js (tsx) |
| DI / 错误追踪 | Effect TS 3.x |
| LLM SDK | Vercel AI SDK v6 + @ai-sdk/deepseek + @ai-sdk/openai |
| HTTP 框架 | Hono 4.x |
| TUI | Ink 7.x + React 19 |
| MCP | @modelcontextprotocol/sdk 1.29.x |
| 校验 | Zod 4.x |
| 日志 | pino 9.x + pino-pretty 13.x |
| 配置 | YAML |
| 测试 | vitest |
| 包管理 | npm workspaces (monorepo) |

---

## 开发

```bash
npm install
npm run typecheck    # 类型检查
npm test             # 运行测试
npm run dev          # 开发模式（watch）
```

---

## License

MIT
