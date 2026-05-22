# Coding Code

> 手写 ReAct Loop · 零 Agent 框架依赖 · 多端统一 · 深度可配置

**Coding Code** 是一个终端原生的 AI 编程助手。核心引擎纯手写 ReAct 循环，通过 HTTP 服务化对外暴露，TUI / Web / Desktop 等所有端共享同一份编排逻辑。用户可以自由配置子智能体、工具、提示词、钩子、模型和工作流——没有黑盒，所有行为都可定制。


三层设计：

| 层 | 包 | 职责 |
|---|---|---|
| 客户端 | `@codingcode/tui` | Ink/React 终端渲染，纯 UI 层 |
| 核心 | `@codingcode/core` | ReAct 引擎、工具系统、上下文管理、会话持久化、HTTP 服务 |
| 基础设施 | `@codingcode/infra` | 配置加载、日志、共享类型 |

关键设计原则：

- **Agent 是纯 ReAct 循环** — 不持有 Session、不调 Bus、不感知传输协议。`agent/` 只做一件事：while 循环调用 LLM + 执行工具。
- **编排逻辑写死在一处** — `orchestrate.ts` 是唯一的跨域编排入口，TUI、Web、SDK 都走同一份代码，不在每个端的 handler 里重复写业务。
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
│   ├── codingcode/src/      # @codingcode/core — 核心引擎
│   │   ├── agent/           #   ReAct Loop（纯引擎，无副作用）
│   │   ├── context/         #   上下文管理 + 自动压缩
│   │   ├── session/         #   JSONL 会话持久化
│   │   ├── llm/             #   LLM 客户端工厂（多厂商）
│   │   ├── tools/           #   工具注册表 + 执行器 + 沙箱
│   │   ├── hooks/           #   可插拔钩子系统
│   │   ├── prompts/         #   角色系统提示词
│   │   ├── sandbox/         #   命令/路径安全过滤
│   │   ├── server/          #   Hono HTTP 服务 + SSE
│   │   └── orchestrate.ts   #   跨域编排（唯一一份）
│   ├── tui/src/             # @codingcode/tui — Ink 终端 UI
│   │   ├── components/      #   App, InputBox, MessageItem 等
│   │   └── hooks/           #   useAgentRunner, useTerminalSize
│   └── infra/src/           # @codingcode/infra — 共享基础设施
├── models.json              # 模型/厂商目录
└── package.json             # npm workspaces monorepo
```

---

## 配置

Coding Code 的核心哲学是**所有行为都可配置**。用户通过三类配置控制 Agent：

| 配置文件 | 作用 |
|---|---|
| `models.json` | 模型厂商、模型列表、API 地址 |
| `codingcode.yaml` | 应用级配置（并发数、超时、token 预算等） |
| `~/.codingcode/rules.md` + `./AGENTS.md` | 全局 + 项目级规则，注入 system prompt |

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

- `driver`: `"deepseek"` 使用原生 SDK，`"openai"` 使用 OpenAI 兼容 API（通用于商汤、千问、硅基流动、Kimi 等）
- `active`: 指定默认使用的厂商
- `api_key_env`: 从环境变量读取 API Key
- 运行时可通过 `/model` 命令或 API 切换模型

### 角色配置

内置三种角色，每种角色有独立的 system prompt 和工具白名单：

| 角色 | 可用工具 | maxSteps | 适用场景 |
|---|---|---|---|
| **Coder** | 全部 6 个工具 | 15 | 日常编码、文件读写、命令执行 |
| **Debugger** | read_file, execute_command, search_code | 20 | 只读调试，不修改文件 |
| **Reviewer** | read_file, search_code | 10 | 纯代码审查，无命令执行权 |

角色系统完全可扩展——在 `prompts/` 目录下新增文件即可添加自定义角色，定义自己的 system prompt 和工具白名单。

### 规则配置

```
~/.codingcode/rules.md        # 全局规则，所有项目生效
./AGENTS.md                  # 项目级规则，自动注入 system prompt
```

规则以 Markdown 编写，在每次 LLM 调用时自动注入到 system prompt 中。可以在这里定义编码规范、项目约定、安全策略等。

---

## 工具系统

### 内置工具

| 工具 | 功能 |
|---|---|
| `read_file` | 读取文件，支持 offset/limit 行号控制 |
| `write_file` | 写入/创建文件 |
| `execute_command` | 执行 shell 命令（带沙箱过滤和超时） |
| `search_code` | 正则搜索项目代码（基于 ripgrep/globby） |
| `fetch_url` | HTTP GET 请求（带超时） |

### 自定义工具

工具通过 `ToolRegistry` 注册，每个工具是一个实现 `ToolDefinition` 接口的对象：

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}
```

在 `cli.ts` 中向 `ToolRegistry` 注册新工具即可——Agent 会自动将其描述传给 LLM，LLM 即可调用。

### 沙箱隔离 (可选)

所有工具执行经过两层安全保护：

**审批流水线**（始终生效）：六层决策链——规则引擎（硬 deny，如 `rm -rf /`）→ 只读白名单 → 权限模式 → 钩子策略 → 用户确认 → 审计日志。不需要额外安装，开箱即用。

**OS 级沙箱**（可选，需安装 `@anthropic-ai/sandbox-runtime`）：

```bash
npm install -g @anthropic-ai/sandbox-runtime
```

安装后的增强能力：

| 能力 | 说明 |
|---|---|
| **文件系统隔离** | 基于 bubblewrap (Linux) / sandbox-exec (macOS) 的 mount namespace，Bash 命令只能看到项目目录，`/etc`、`/home` 等不可见 |
| **网络隔离** | 内置 HTTP/SOCKS 代理，只允许白名单域名通过，IP 地址直连被拦截 |
| **防绕过** | 即使 prompt injection 让模型生成 `cat /etc/shadow`，沙箱层会拒绝——文件在 OS 层不可见，不依赖字符串匹配 |

不安装不影响使用——审批流水线独立运行，同样能拦截危险命令。沙箱只是多一层 OS 级防御，防止绕过应用层检查的攻击。

---

## 钩子系统 (Hooks)

8 个可插拔钩子点，用户可以在关键节点注入自定义逻辑：

| 钩子点 | 触发时机 |
|---|---|
| `tool.execute.before` | 工具执行前 |
| `tool.execute.after` | 工具执行成功后 |
| `tool.execute.error` | 工具执行失败后 |
| `llm.request.before` | LLM 调用前（可修改 messages） |
| `llm.response.after` | LLM 响应成功后 |
| `llm.response.error` | LLM 调用失败后 |
| `session.save.before` | 会话保存前 |
| `session.save.after` | 会话保存后 |

```typescript
// 示例：在每次 LLM 调用前打印 token 估算
hookRegistry.on('llm.request.before', async (messages) => {
  const estimatedTokens = JSON.stringify(messages).length / 4;
  console.log(`[Hook] 即将调用 LLM，预估 ${Math.round(estimatedTokens)} tokens`);
});

// 示例：工具执行后自动 git add
hookRegistry.on('tool.execute.after', async (name, args, result) => {
  if (name === 'write_file' && result.ok) {
    await $`git add ${args.path}`;
  }
});
```

---

## 子智能体 (Subagent)

> 当前处于能力预留阶段，类型和注册表接口已定义。

设计目标：

- 每个子 Agent 是独立的 ReAct 引擎实例，拥有**受限的工具集**和**独立的上下文**
- 通过 Worker 线程实现真正的并行执行和崩溃隔离
- 主 Agent 通过 `delegate_to_subagent` 工具委派任务
- 用户可以**自由定义子 Agent 模板**：配置其工具白名单、system prompt、步数限制、超时

```typescript
// 子 Agent 模板示例（规划中）
{
  name: "code-searcher",
  description: "专门搜索代码库的子 Agent",
  tools: ["search_code", "read_file"],
  systemPrompt: "You are a code search specialist...",
  maxSteps: 10,
  timeoutMs: 60000
}
```

子 Agent 注册表位于 `subagent/` 模块，用户可以像配置角色一样配置子 Agent 模板。

---

## 工作流

Coding Code 的工作流由以下可组合元素构成：

```
用户输入 → System Prompt（角色 + 规则）
         → LLM 调用（模型可切换）
         → ReAct Loop（步数可配置）
            ├── 工具调用（沙箱过滤 + 钩子注入）
            ├── 子 Agent 委派（可选，并行）
            └── 上下文压缩（自动触发，90% token 预算）
         → 响应流（SSE 实时推送）
         → 会话持久化（JSONL）
```

每个环节都可配置：

| 环节 | 配置方式 |
|---|---|
| System Prompt | 角色文件 (`prompts/`) + 规则文件 (`rules.md` / `AGENTS.md`) |
| LLM 厂商和模型 | `models.json` + 运行时 `/model` 切换 |
| 最大步数 | 角色配置中的 `maxSteps` |
| Token 预算和压缩阈值 | `codingcode.yaml` 或 ContextService 参数 |
| 工具白名单 | 角色配置 |
| 钩子 | `HookRegistry` 编程接口 |
| 子 Agent 行为 | 子 Agent 模板配置 |

没有黑盒的"工作流引擎"——所有行为都是显式的配置和纯函数组合。

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
   │   TUI   │         │   Web   │          │ Desktop │
   │  (Ink)  │         │ (React) │          │(Electron)│
   └─────────┘         └─────────┘          └─────────┘
```

### TUI (`@codingcode/tui`)

- 基于 **Ink v7** (React for terminal)，Normal Screen 模式
- 键盘快捷键: 消息聚焦 (↑↓)、展开详情 (Ctrl+O)、面板切换 (/model, /role, /sessions, /help)
- 通过 HTTP 客户端连接 server，不持有 Agent 引用，不解析协议
- 输入只是 `AsyncGenerator<string>` 流

### Web

- HTTP API + SSE 天然支持浏览器端
- `CodingCodeClient` SDK 封装了 HTTP 调用和 SSE 流解析
- 任何前端框架均可接入

### Desktop

- 计划通过 Electron 包装 Web UI
- 复用同一套 HTTP API，零额外后端开发

### SDK

```typescript
import { CodingCodeClient } from '@codingcode/core';

const client = new CodingCodeClient('http://localhost:3000');

// 创建会话
const session = await client.createSession();

// 发送消息（SSE 流式接收）
for await (const chunk of client.sendMessage(session.id, '帮我写一个快排')) {
  process.stdout.write(chunk);
}
```

---

## 上下文管理与压缩

上下文管理是独立域 (`context/`)，不耦合在 Agent 内部：

- **自动压缩**: 当上下文超过 token 预算的 90%（默认 200K），自动触发压缩
- **两种策略**: (1) 截断旧工具输出 (2) 总结最早的消息
- **显式压缩**: 可通过 `POST /api/sessions/:id/compact` 手动触发
- 压缩边界记录到 session JSONL，resume 时不会丢失历史

---

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript 5.8, ESNext |
| 运行时 | Node.js (tsx) |
| DI / 错误追踪 | Effect TS 3.x |
| LLM SDK | Vercel AI SDK v6 + @ai-sdk/deepseek + @ai-sdk/openai |
| HTTP 框架 | Hono 4.x |
| TUI | Ink 7.x + React 19 |
| 校验 | Zod 4.x |
| 日志 | pino + pino-pretty |
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
